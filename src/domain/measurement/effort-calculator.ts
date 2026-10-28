import { Timestamp } from '../shared/timestamp.js';
import type { ActivityEvent, TurnOrigin } from './activity-events.js';
import { Duration } from './duration.js';
import { UNCERTAINTY_TARGET, type EffortReport } from './effort-report.js';
import type { IdlePolicy } from './idle-policy.js';
import { Interval } from './interval.js';
import { IntervalSet } from './interval-set.js';
import type { ManualTime } from './manual-time.js';
import type { ParallelPeriod } from './parallel-mode.js';

/*
 * Turns the activity journal of a task into intervals of agents and of the
 * user (effort-metrics spec). Pure: time, settings and records come in as
 * arguments. Times are compared as milliseconds inside this module only.
 */

export interface EffortInput {
  /** Activity events in journal order. */
  readonly activity: readonly ActivityEvent[];
  readonly startedAt: Timestamp;
  readonly manual: readonly ManualTime[];
  readonly parallel: readonly ParallelPeriod[];
  readonly policy: IdlePolicy;
  readonly now: Timestamp;
}

/** Repeated deliveries of one hook arrive within this window. */
const DUPLICATE_WINDOW_MS = 2_000;

/** Agent id of the main agent of a session. */
const MAIN = '';

export interface AgentTimeline {
  readonly session: string;
  /** Undefined for the main agent of the session. */
  readonly agent: string | undefined;
  /** Key of the agent that started this one; undefined for the main agent. */
  readonly parent: string | undefined;
  readonly background: boolean;
  readonly intervals: IntervalSet;
}

/** Measured intervals before manual time is added, all clipped to the start of the task. */
export interface Timeline {
  /** Keyed by `session/agent`; the main agent has an empty agent part. */
  readonly agents: ReadonlyMap<string, AgentTimeline>;
  readonly user: IntervalSet;
  /** Per session, for checks that agent and user time of one session never overlap. */
  readonly userBySession: ReadonlyMap<string, IntervalSet>;
  readonly doubts: { readonly agent: IntervalSet; readonly user: IntervalSet };
}

export function measureEffort(input: EffortInput): EffortReport {
  const timeline = buildTimeline(input);
  const agentMeasured = IntervalSet.of([...timeline.agents.values()].flatMap((agent) => agent.intervals.intervals));
  const userMeasured = timeline.user;

  const manual = splitManual(input.manual);
  const agentTime = agentMeasured.union(manual.agentIntervals).total.plus(manual.agentWithoutTime);
  const userTime = userMeasured.union(manual.userIntervals).total.plus(manual.userWithoutTime);
  const fact = agentTime.plus(userTime);
  const manualTime = fact.minus(agentMeasured.total.plus(userMeasured.total));
  const uncertainty = timeline.doubts.agent.total.plus(timeline.doubts.user.total);

  const agentWork = Duration.sum(
    [...timeline.agents.entries()].map(([key, agent]) => {
      const foreground = [...timeline.agents.values()].filter((child) => child.parent === key && !child.background);
      return agent.intervals.minus(IntervalSet.of(foreground.flatMap((child) => child.intervals.intervals))).total;
    }),
  ).plus(Duration.sum(input.manual.filter((record) => record.kind === 'agent').map((record) => record.duration)));

  const used = input.parallel.length > 0;
  const agentCounts = input.parallel.map((period) => period.change.agents).filter((n) => n !== undefined);
  return {
    agentTime,
    userTime,
    fact,
    uncertainty,
    uncertaintyShare: share(uncertainty, fact),
    exceedsUncertaintyTarget:
      fact.millis === 0 ? uncertainty.millis > 0 : uncertainty.millis / fact.millis > UNCERTAINTY_TARGET,
    manualTime,
    manualShare: share(manualTime, fact),
    agentWork,
    sequentialEquivalent: used ? agentWork.plus(userTime) : undefined,
    calendar: Duration.between(input.startedAt, input.now),
    parallel: { used, maxAgents: agentCounts.length === 0 ? undefined : Math.max(...agentCounts) },
    measured: { agent: agentMeasured, user: userMeasured },
  };
}

export function buildTimeline(input: EffortInput): Timeline {
  const collector = new Collector(input.policy.threshold.millis);
  const context = { startedAt: input.startedAt.toMillis(), now: input.now.toMillis() };

  for (const [session, events] of bySession(prepare(input.activity))) {
    const streams = new Map<string, Prepared[]>();
    for (const item of events) {
      push(streams, agentOf(item.event) ?? MAIN, item);
    }
    const sessionEnds = events.filter((item) => item.event.type === 'session.ended').map((item) => item.at);
    collector.describe(key(session, MAIN), { session, agent: undefined, parent: undefined, background: false });
    mainStream(session, streams.get(MAIN) ?? [], collector, context);
    for (const [agent, items] of streams) {
      if (agent !== MAIN) {
        subagentStream(session, agent, items, sessionEnds, collector, context);
      }
    }
  }
  return collector.timeline(input.startedAt);
}

interface Prepared {
  readonly event: ActivityEvent;
  readonly at: number;
}

interface Context {
  readonly startedAt: number;
  readonly now: number;
}

/**
 * Orders events by time (journal order breaks ties) and drops repeated deliveries:
 * a hook installed twice delivers the same event right after the first copy,
 * before the next event of its agent, so a repeat is a copy of the previous event
 * of the same agent, not of any earlier one.
 */
function prepare(events: readonly ActivityEvent[]): Prepared[] {
  const sorted = events
    .map((event, index) => ({ event, at: Timestamp.parse(event.ts).toMillis(), index }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const previous = new Map<string, { duplicateKey: string | undefined; at: number }>();
  /** Copies with the very same time can be split by the tie order, so they are matched by key and time alone. */
  const sameTime = new Set<string>();
  const result: Prepared[] = [];
  for (const item of sorted) {
    const stream = key(item.event.data.session, agentOf(item.event) ?? MAIN);
    const duplicateKey = duplicateKeyOf(item.event);
    if (duplicateKey !== undefined) {
      const last = previous.get(stream);
      const exact = `${stream} ${duplicateKey} ${item.at}`;
      if (sameTime.has(exact) || (last?.duplicateKey === duplicateKey && item.at - last.at <= DUPLICATE_WINDOW_MS)) {
        continue;
      }
      sameTime.add(exact);
    }
    previous.set(stream, { duplicateKey, at: item.at });
    result.push({ event: item.event, at: item.at });
  }
  return result;
}

/** Two quick calls of the same tool are normal, so tool events without an id are never treated as repeats. */
function duplicateKeyOf(event: ActivityEvent): string | undefined {
  const toolUseId = 'toolUseId' in event.data ? event.data.toolUseId : undefined;
  if ((event.type === 'tool.started' || event.type === 'tool.used') && toolUseId === undefined) {
    return undefined;
  }
  return JSON.stringify([event.type, toolUseId ?? '']);
}

function bySession(items: readonly Prepared[]): Map<string, Prepared[]> {
  const sessions = new Map<string, Prepared[]>();
  for (const item of items) {
    push(sessions, item.event.data.session, item);
  }
  return sessions;
}

function push<T>(groups: Map<string, T[]>, groupKey: string, item: T): void {
  const group = groups.get(groupKey);
  if (group) {
    group.push(item);
  } else {
    groups.set(groupKey, [item]);
  }
}

function agentOf(event: ActivityEvent): string | undefined {
  return 'agent' in event.data ? event.data.agent : undefined;
}

function key(session: string, agent: string): string {
  return `${session}/${agent}`;
}

/**
 * The main agent of a session alternates with the user: while a turn runs the
 * time is the agent's, between turns it is the user's. Automated turns are
 * agent time and leave the user's span open.
 */
function mainStream(session: string, items: readonly Prepared[], c: Collector, ctx: Context): void {
  const agentKey = key(session, MAIN);
  let turn: { run: Run; origin: TurnOrigin } | undefined;
  /** The user has control: the span opened by `session.started` or by the end of a user turn. */
  let span = false;
  let cursor = 0;
  /** The next user gap follows a turn closed by a heuristic, which already counted its doubt. */
  let quiet = false;
  let seen = false;

  const userUntil = (at: number): void => {
    if (span) {
      c.userGap(session, cursor, at, quiet);
      cursor = at;
    }
    quiet = false;
  };
  const closeTurn = (at: number): void => {
    if (turn?.origin === 'user') {
      span = true;
    }
    if (span) {
      cursor = at;
    }
    turn = undefined;
  };
  /** A turn that never got its closing event ends at its last event; the rest is doubtful. */
  const abandonTurn = (next: number): void => {
    if (!turn) {
      return;
    }
    const last = turn.run.last;
    c.doubt('agent', last, Math.min(last + c.idle, next));
    closeTurn(last);
    quiet = true;
  };

  for (const { event, at } of items) {
    switch (event.type) {
      case 'session.started':
        if (turn) {
          continue; // context compaction inside a turn, not a new start
        }
        if (span) {
          userUntil(at);
        } else {
          span = true;
          cursor = at;
          quiet = false;
        }
        break;
      case 'session.ended':
        if (turn) {
          turn.run.end(at);
          turn = undefined;
        } else {
          userUntil(at);
        }
        span = false;
        break;
      case 'turn.started':
        if (turn) {
          abandonTurn(at); // interrupted: the tool never reported the end of the previous turn
        }
        userUntil(at);
        if (event.data.origin === 'user') {
          span = false;
        }
        turn = { run: new Run(session, agentKey, at, c), origin: event.data.origin };
        break;
      default:
        if (!turn) {
          if (seen) {
            continue; // e.g. a notification after the turn ended
          }
          // The session joined the task mid-turn (`emt start` ran inside it): the turn began at the start.
          const start = Math.min(at, Math.max(ctx.startedAt, at - c.idle));
          c.addAgent(agentKey, start, at);
          c.doubt('agent', start, at);
          turn = { run: new Run(session, agentKey, at, c), origin: 'user' };
        }
        turn.run.step(event, at);
        if (event.type === 'turn.ended') {
          closeTurn(at);
        }
    }
    seen = true;
  }

  if (turn) {
    if (ctx.now - turn.run.last <= c.idle) {
      turn.run.end(ctx.now); // still running
    } else {
      abandonTurn(ctx.now);
    }
  }
  if (!turn) {
    userUntil(ctx.now);
  }
}

/** A subagent runs from `agent.started` (or its first event) to `agent.stopped`. */
function subagentStream(
  session: string,
  agent: string,
  items: readonly Prepared[],
  sessionEnds: readonly number[],
  c: Collector,
  ctx: Context,
): void {
  const agentKey = key(session, agent);
  c.describe(agentKey, { session, agent, parent: key(session, MAIN), background: false });
  let run: Run | undefined;
  const abandon = (next: number): void => {
    if (run) {
      c.doubt('agent', run.last, Math.min(run.last + c.idle, next));
    }
  };

  for (const { event, at } of items) {
    if (event.type === 'agent.started') {
      abandon(at);
      c.describe(agentKey, {
        session,
        agent,
        parent: key(session, event.data.parentAgent ?? MAIN),
        background: event.data.background ?? false,
      });
      run = new Run(session, agentKey, at, c);
      continue;
    }
    run ??= new Run(session, agentKey, at, c);
    run.step(event, at);
    if (event.type === 'agent.stopped') {
      run = undefined;
    }
  }

  if (run) {
    const last = run.last;
    const sessionEnd = sessionEnds.find((end) => end >= last);
    if (sessionEnd !== undefined) {
      run.end(sessionEnd);
    } else if (ctx.now - last <= c.idle) {
      run.end(ctx.now);
    } else {
      abandon(ctx.now);
    }
  }
}

/** One stretch of work of one agent: a turn of the main agent or the life of a subagent. */
class Run {
  last: number;
  private waiting = false;
  private readonly tools = new Set<string>();
  /** Tools started without an id; matched with completions by order. */
  private anonymousTools = 0;

  constructor(
    private readonly session: string,
    private readonly agentKey: string,
    start: number,
    private readonly c: Collector,
  ) {
    this.last = start;
  }

  /** Accounts for the time since the previous event, then applies `event`. */
  step(event: ActivityEvent, at: number): void {
    if (this.waiting) {
      // Waiting for the user outweighs a running tool: a permission prompt keeps the tool "running".
      let waitEnd = at;
      let untimed = false;
      if (event.type === 'tool.used') {
        const paired = this.finishTool(event.data.toolUseId);
        if (paired && event.data.durationMs !== undefined) {
          waitEnd = Math.max(this.last, at - event.data.durationMs);
        } else if (paired) {
          untimed = true;
        }
      }
      this.c.waiting(this.agentKey, this.session, this.last, waitEnd, untimed);
      this.c.agentGap(this.agentKey, waitEnd, at, true);
      this.waiting = false;
    } else {
      this.c.agentGap(this.agentKey, this.last, at, this.toolRunning);
      if (event.type === 'tool.used') {
        this.finishTool(event.data.toolUseId);
      }
    }
    if (event.type === 'tool.started') {
      if (event.data.toolUseId === undefined) {
        this.anonymousTools += 1;
      } else {
        this.tools.add(event.data.toolUseId);
      }
    }
    if (event.type === 'turn.awaiting-input') {
      this.waiting = true;
    }
    this.last = at;
  }

  /** Ends the run at `at` without a closing event of its own (session end, or now while it runs). */
  end(at: number): void {
    if (this.waiting) {
      this.c.waiting(this.agentKey, this.session, this.last, at, false);
    } else {
      this.c.agentGap(this.agentKey, this.last, at, this.toolRunning);
    }
    this.last = Math.max(this.last, at);
  }

  private get toolRunning(): boolean {
    return this.tools.size > 0 || this.anonymousTools > 0;
  }

  /** Returns true if the completion matched a started tool. */
  private finishTool(toolUseId: string | undefined): boolean {
    if (toolUseId !== undefined && this.tools.delete(toolUseId)) {
      return true;
    }
    if (this.anonymousTools > 0) {
      this.anonymousTools -= 1;
      return true;
    }
    return false;
  }
}

interface AgentInfo {
  readonly session: string;
  readonly agent: string | undefined;
  readonly parent: string | undefined;
  readonly background: boolean;
}

/** Collects intervals and doubtful stretches and applies the idle rules to gaps. */
class Collector {
  private readonly agents = new Map<string, { info: AgentInfo; intervals: Interval[] }>();
  private readonly user = new Map<string, Interval[]>();
  private readonly doubts = { agent: [] as Interval[], user: [] as Interval[] };
  /** Stretches in which an agent waited for the user, by agent. */
  private readonly waits = new Map<string, Interval[]>();

  constructor(readonly idle: number) {}

  describe(agentKey: string, info: AgentInfo): void {
    const existing = this.agents.get(agentKey);
    this.agents.set(agentKey, { info, intervals: existing?.intervals ?? [] });
  }

  addAgent(agentKey: string, start: number, end: number): void {
    if (end > start) {
      this.agents.get(agentKey)?.intervals.push(interval(start, end));
    }
  }

  doubt(kind: 'agent' | 'user', start: number, end: number): void {
    if (end > start) {
      this.doubts[kind].push(interval(start, end));
    }
  }

  /** A stretch without events inside an agent run. */
  agentGap(agentKey: string, start: number, end: number, toolRunning: boolean): void {
    const length = end - start;
    if (length <= 0) {
      return;
    }
    if (toolRunning) {
      this.addAgent(agentKey, start, end);
      if (length > 2 * this.idle) {
        this.doubt('agent', start, end);
      }
      return;
    }
    this.silence(length, start, end, false, () => this.addAgent(agentKey, start, end), 'agent');
  }

  /** A stretch while the user has control of a session. */
  userGap(session: string, start: number, end: number, quiet: boolean): void {
    this.silence(end - start, start, end, quiet, () => this.addUser(session, start, end), 'user');
  }

  /** The agent waits for the user: the user's time if short, a pause if long. */
  waiting(agentKey: string, session: string, start: number, end: number, endedByUntimedTool: boolean): void {
    const length = end - start;
    if (length <= 0) {
      return;
    }
    push(this.waits, agentKey, interval(start, end));
    this.silence(length, start, end, false, () => this.addUser(session, start, end), 'user');
    if (endedByUntimedTool && length > 2 * this.idle) {
      this.doubt('agent', start, end); // the tool may have been working for part of it
    }
  }

  timeline(startedAt: Timestamp): Timeline {
    const blocked = this.blockedByWaits();
    const agents = new Map<string, AgentTimeline>();
    for (const [agentKey, { info, intervals }] of this.agents) {
      const own = IntervalSet.of(intervals).minus(IntervalSet.of(blocked.get(agentKey) ?? []));
      agents.set(agentKey, { ...info, intervals: own.from(startedAt) });
    }
    const userBySession = new Map<string, IntervalSet>();
    for (const [session, intervals] of this.user) {
      // A subagent's wait is the user's time, but the main agent of the session may be busy meanwhile.
      const main = agents.get(key(session, MAIN))?.intervals ?? IntervalSet.EMPTY;
      userBySession.set(session, IntervalSet.of(intervals).from(startedAt).minus(main));
    }
    return {
      agents,
      user: IntervalSet.of([...userBySession.values()].flatMap((set) => set.intervals)),
      userBySession,
      doubts: {
        agent: IntervalSet.of(this.doubts.agent).from(startedAt),
        user: IntervalSet.of(this.doubts.user).from(startedAt),
      },
    };
  }

  /**
   * A parent that waits for a foreground subagent is blocked while that subagent
   * waits for the user, and so is its own parent if it is a foreground subagent too.
   */
  private blockedByWaits(): Map<string, Interval[]> {
    const blocked = new Map<string, Interval[]>();
    for (const [agentKey, waits] of this.waits) {
      let child = this.agents.get(agentKey)?.info;
      while (child?.agent !== undefined && !child.background && child.parent !== undefined) {
        for (const wait of waits) {
          push(blocked, child.parent, wait);
        }
        child = this.agents.get(child.parent)?.info;
      }
    }
    return blocked;
  }

  /**
   * Idle rules for a silence: up to the threshold it counts, and the part beyond
   * half the threshold is doubtful; beyond it is a pause, doubtful up to twice the threshold.
   */
  private silence(
    length: number,
    start: number,
    end: number,
    quiet: boolean,
    count: () => void,
    kind: 'agent' | 'user',
  ): void {
    if (length <= 0) {
      return;
    }
    if (length <= this.idle) {
      count();
      if (!quiet && length > this.idle / 2) {
        this.doubt(kind, start + this.idle / 2, end);
      }
    } else if (!quiet && length <= 2 * this.idle) {
      this.doubt(kind, start, end);
    }
  }

  private addUser(session: string, start: number, end: number): void {
    if (end > start) {
      push(this.user, session, interval(start, end));
    }
  }
}

function interval(start: number, end: number): Interval {
  return Interval.of(Timestamp.fromMillis(start), Timestamp.fromMillis(end));
}

function splitManual(records: readonly ManualTime[]): {
  agentIntervals: IntervalSet;
  userIntervals: IntervalSet;
  agentWithoutTime: Duration;
  userWithoutTime: Duration;
} {
  const timed = (kind: 'user' | 'agent'): IntervalSet =>
    IntervalSet.of(
      records
        .filter((record) => record.kind === kind && record.at !== undefined)
        .map((record) => Interval.endingAt(record.at as Timestamp, record.duration)),
    );
  const untimed = (kind: 'user' | 'agent'): Duration =>
    Duration.sum(records.filter((record) => record.kind === kind && record.at === undefined).map((r) => r.duration));
  return {
    agentIntervals: timed('agent'),
    userIntervals: timed('user'),
    agentWithoutTime: untimed('agent'),
    userWithoutTime: untimed('user'),
  };
}

function share(part: Duration, whole: Duration): number | undefined {
  return whole.millis === 0 ? undefined : part.millis / whole.millis;
}
