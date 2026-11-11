import type { Timestamp } from '../shared/timestamp.js';
import type { Interval } from './interval.js';
import { IntervalSet } from './interval-set.js';
import type { Window } from './session-windows.js';
import { interval, key, MAIN, push, union, type AgentTimeline, type Bound, type Timeline } from './timeline.js';

/** Bounds for infinite window ends; the same range Timestamp accepts. */
const EARLIEST_MS = -8.64e15;
const LATEST_MS = 8.64e15;

export interface AgentInfo {
  readonly session: string;
  readonly agent: string | undefined;
  readonly parent: string | undefined;
  readonly background: boolean;
}

/** Collects intervals and doubtful stretches and applies the idle rules to gaps. */
export class Collector {
  private readonly agents = new Map<string, { info: AgentInfo; intervals: Interval[] }>();
  private readonly user = new Map<string, Interval[]>();
  /** Doubtful stretches with their owner, so they are clipped by the windows of their session. */
  private readonly doubts: Doubt[] = [];
  /** Stretches in which an agent waited for the user, by agent. */
  private readonly waits = new Map<string, Interval[]>();
  private readonly windows = new Map<string, readonly Window[]>();
  private readonly detached = new Set<string>();

  constructor(readonly idle: number) {}

  /** The background flag sticks: a resumed subagent or a late `agent.detached` keeps it. */
  describe(agentKey: string, info: AgentInfo): void {
    const existing = this.agents.get(agentKey);
    const background = info.background || (existing?.info.background ?? false) || this.detached.has(agentKey);
    this.agents.set(agentKey, { info: { ...info, background }, intervals: existing?.intervals ?? [] });
  }

  detach(agentKey: string): void {
    this.detached.add(agentKey);
    const existing = this.agents.get(agentKey);
    if (existing) {
      this.agents.set(agentKey, { ...existing, info: { ...existing.info, background: true } });
    }
  }

  window(session: string, windows: readonly Window[] | undefined): void {
    if (windows !== undefined) {
      this.windows.set(session, windows);
    }
  }

  addAgent(agentKey: string, start: number, end: number): void {
    if (end > start) {
      this.agents.get(agentKey)?.intervals.push(interval(start, end));
    }
  }

  /** `owner` is the agent key, or undefined for the user of the session; `counted` says the heuristic kept the stretch. */
  doubt(session: string, owner: string | undefined, counted: boolean, start: number, end: number): void {
    if (end > start) {
      this.doubts.push({ session, owner, counted, interval: interval(start, end) });
    }
  }

  /** A stretch without events inside an agent run. */
  agentGap(agentKey: string, start: number, end: number, toolRunning: boolean): void {
    const length = end - start;
    if (length <= 0) {
      return;
    }
    const session = this.sessionOf(agentKey);
    if (toolRunning) {
      this.addAgent(agentKey, start, end);
      if (length > 2 * this.idle) {
        this.doubt(session, agentKey, true, start, end);
      }
      return;
    }
    this.silence(session, length, start, end, false, () => this.addAgent(agentKey, start, end), agentKey);
  }

  /** A stretch while the user has control of a session. */
  userGap(session: string, start: number, end: number, quiet: boolean): void {
    this.silence(session, end - start, start, end, quiet, () => this.addUser(session, start, end), undefined);
  }

  /** The agent waits for the user: the user's time if short, a pause if long. */
  waiting(agentKey: string, session: string, start: number, end: number, endedByUntimedTool: boolean): void {
    const length = end - start;
    if (length <= 0) {
      return;
    }
    push(this.waits, agentKey, interval(start, end));
    this.silence(session, length, start, end, false, () => this.addUser(session, start, end), undefined);
    if (endedByUntimedTool && length > 2 * this.idle) {
      this.doubt(session, agentKey, false, start, end); // the tool may have been working for part of it
    }
  }

  timeline(startedAt: Timestamp): Timeline {
    const blocked = this.blockedByWaits();
    const own = new Map<string, IntervalSet>();
    for (const [agentKey, { intervals }] of this.agents) {
      own.set(agentKey, IntervalSet.of(intervals).minus(IntervalSet.of(blocked.get(agentKey) ?? [])));
    }
    const agents = new Map<string, AgentTimeline>();
    for (const [agentKey, { info }] of this.agents) {
      agents.set(agentKey, { ...info, intervals: this.clip(info.session, (own.get(agentKey) ?? IntervalSet.EMPTY).intervals, startedAt) });
    }
    const userBySession = new Map<string, IntervalSet>();
    for (const [session, intervals] of this.user) {
      // A subagent's wait is the user's time, but the main agent of the session may be busy meanwhile.
      const main = agents.get(key(session, MAIN))?.intervals ?? IntervalSet.EMPTY;
      userBySession.set(session, this.clip(session, intervals, startedAt).minus(main));
    }
    return {
      agents,
      user: IntervalSet.of([...userBySession.values()].flatMap((set) => set.intervals)),
      userBySession,
      bounds: { low: this.low(agents, userBySession, startedAt), high: this.high(own, userBySession, startedAt) },
    };
  }

  /** Doubtful stretches of one owner, clipped like the time they belong to. */
  private doubtsOf(session: string, owner: string | undefined, counted: boolean, startedAt: Timestamp): IntervalSet {
    const own = this.doubts.filter((d) => d.session === session && d.owner === owner && d.counted === counted);
    return this.clip(session, own.map((d) => d.interval), startedAt);
  }

  /** The fact without the counted doubts: each owner loses its own, the rest stays (a busy other session still counts). */
  private low(agents: ReadonlyMap<string, AgentTimeline>, userBySession: ReadonlyMap<string, IntervalSet>, startedAt: Timestamp): Bound {
    const agentSets = [...agents.entries()].map(([agentKey, agent]) => agent.intervals.minus(this.doubtsOf(agent.session, agentKey, true, startedAt)));
    const userSets = [...userBySession.entries()].map(([session, user]) => user.minus(this.doubtsOf(session, undefined, true, startedAt)));
    return { agents: union(agentSets), user: union(userSets) };
  }

  /**
   * The fact with the discarded doubts: each owner gets its own back. The user
   * of a session and its main agent never share time, so a stretch of the main
   * agent comes in only where it is not the user's time already; taking it from
   * the user would only lower the fact, not raise it.
   */
  private high(own: ReadonlyMap<string, IntervalSet>, userBySession: ReadonlyMap<string, IntervalSet>, startedAt: Timestamp): Bound {
    const sessions = new Set([...userBySession.keys(), ...this.doubts.filter((d) => d.owner === undefined).map((d) => d.session)]);
    const users = new Map(
      [...sessions].map((session) => [session, (userBySession.get(session) ?? IntervalSet.EMPTY).union(this.doubtsOf(session, undefined, false, startedAt))]),
    );
    const agents: IntervalSet[] = [];
    for (const [agentKey, { info }] of this.agents) {
      const kept = this.clip(info.session, (own.get(agentKey) ?? IntervalSet.EMPTY).intervals, startedAt);
      const doubts = this.doubtsOf(info.session, agentKey, false, startedAt);
      const added = info.agent === undefined ? doubts.minus(users.get(info.session) ?? IntervalSet.EMPTY) : doubts;
      agents.push(kept.union(added));
    }
    return { agents: union(agents), user: union([...users.values()]) };
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
    session: string,
    length: number,
    start: number,
    end: number,
    quiet: boolean,
    count: () => void,
    owner: string | undefined,
  ): void {
    if (length <= 0) {
      return;
    }
    if (length <= this.idle) {
      count();
      if (!quiet && length > this.idle / 2) {
        this.doubt(session, owner, true, start + this.idle / 2, end);
      }
    } else if (!quiet && length <= 2 * this.idle) {
      this.doubt(session, owner, false, start, end);
    }
  }

  private sessionOf(agentKey: string): string {
    return this.agents.get(agentKey)?.info.session ?? agentKey.slice(0, agentKey.lastIndexOf('/'));
  }

  /** Clipped to the start of the task and to the windows in which the session served it. */
  private clip(session: string, intervals: Iterable<Interval>, startedAt: Timestamp): IntervalSet {
    const clipped = IntervalSet.of(intervals).from(startedAt);
    const windows = this.windows.get(session);
    if (windows === undefined) {
      return clipped;
    }
    const allowed = IntervalSet.of(windows.map((w) => interval(Math.max(w.start, EARLIEST_MS), Math.min(w.end, LATEST_MS))));
    const outside = IntervalSet.of([interval(EARLIEST_MS, LATEST_MS)]).minus(allowed);
    return clipped.minus(outside);
  }

  private addUser(session: string, start: number, end: number): void {
    if (end > start) {
      push(this.user, session, interval(start, end));
    }
  }
}

interface Doubt {
  readonly session: string;
  /** Agent key; undefined for the user of the session. */
  readonly owner: string | undefined;
  /** The heuristic kept the stretch in the fact (true) or left it out (false). */
  readonly counted: boolean;
  readonly interval: Interval;
}
