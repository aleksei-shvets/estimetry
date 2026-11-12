import type { Timestamp } from '../shared/timestamp.js';
import type { ActivityEvent } from './activity-events.js';
import { Collector } from './collector.js';
import { Duration } from './duration.js';
import { UNCERTAINTY_TARGET, type EffortReport } from './effort-report.js';
import type { IdlePolicy } from './idle-policy.js';
import { IntervalSet } from './interval-set.js';
import type { LogBoundaries } from './log-boundaries.js';
import { mainStream } from './main-stream.js';
import type { ManualTime } from './manual-time.js';
import type { ParallelPeriod } from './parallel-mode.js';
import { agentOf, bySession, prepare, type Prepared } from './prepared-events.js';
import type { StreamContext } from './run.js';
import { sessionWindows, windowStart } from './session-windows.js';
import { subagentStream } from './subagent-stream.js';
import { interval, key, MAIN, push, type Timeline } from './timeline.js';

export type { AgentTimeline, Bound, Timeline } from './timeline.js';

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
  /**
   * Windows of work thrown away by revisions (estimate-revision spec): taken
   * out of every agent, the user, the doubts and timed manual time. Manual
   * time without a moment stays: its record says nothing about when the work was done.
   */
  readonly lost?: IntervalSet;
  /** What the session logs tell, by session: they stand in for closing and starting events the hooks missed. */
  readonly logs?: ReadonlyMap<string, LogBoundaries>;
}

/** Describes an agent instead of advancing its run. */
const NOT_STEPS: ReadonlySet<ActivityEvent['type']> = new Set(['agent.detached']);

export function measureEffort(input: EffortInput): EffortReport {
  const timeline = withoutLost(buildTimeline(input), input.lost ?? IntervalSet.EMPTY);
  const agentMeasured = IntervalSet.of([...timeline.agents.values()].flatMap((agent) => agent.intervals.intervals));
  const userMeasured = timeline.user;

  const manual = splitManual(input.manual, input.lost ?? IntervalSet.EMPTY);
  const factOf = (agents: IntervalSet, user: IntervalSet): Duration =>
    agents
      .union(manual.agentIntervals)
      .total.plus(manual.agentWithoutTime)
      .plus(user.union(manual.userIntervals).total.plus(manual.userWithoutTime));
  const agentTime = agentMeasured.union(manual.agentIntervals).total.plus(manual.agentWithoutTime);
  const userTime = userMeasured.union(manual.userIntervals).total.plus(manual.userWithoutTime);
  const fact = agentTime.plus(userTime);
  const manualTime = fact.minus(agentMeasured.total.plus(userMeasured.total));
  const factLow = factOf(timeline.bounds.low.agents, timeline.bounds.low.user);
  const factHigh = factOf(timeline.bounds.high.agents, timeline.bounds.high.user);
  const uncertainty = factHigh.minus(factLow);

  const agentWork = Duration.sum(
    [...timeline.agents.entries()].map(([key, agent]) => {
      const foreground = [...timeline.agents.values()].filter((child) => child.parent === key && !child.background);
      return agent.intervals.minus(IntervalSet.of(foreground.flatMap((child) => child.intervals.intervals))).total;
    }),
  ).plus(manual.agentWork);

  const used = input.parallel.length > 0;
  const agentCounts = input.parallel.map((period) => period.change.agents).filter((n) => n !== undefined);
  return {
    agentTime,
    userTime,
    fact,
    factLow,
    factHigh,
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
    backgroundAgents: [...timeline.agents.values()].some((agent) => agent.background && agent.intervals.total.millis > 0),
    measured: { agent: agentMeasured, user: userMeasured },
  };
}

export function buildTimeline(input: EffortInput): Timeline {
  const collector = new Collector(input.policy.threshold.millis);
  const startedAt = input.startedAt.toMillis();
  const now = input.now.toMillis();

  for (const [session, all] of bySession(prepare(input.activity))) {
    // Windows and the background flag are facts about the session and its agents, not steps of a run.
    const windows = sessionWindows(all);
    collector.window(session, windows);
    for (const item of all) {
      if (item.event.type === 'agent.detached') {
        collector.detach(key(session, item.event.data.agent));
      }
    }
    const events = all.filter(({ event }) => !NOT_STEPS.has(event.type));
    const log = input.logs?.get(session);
    const context: StreamContext = { startedAt, now, windowStart: (at) => windowStart(windows, at), ...(log === undefined ? {} : { log }) };
    const streams = new Map<string, Prepared[]>();
    for (const item of events) {
      push(streams, agentOf(item.event) ?? MAIN, item);
    }
    // A subagent still running when the session ends, or leaves this task, ends then.
    const sessionEnds = events
      .filter((item) => item.event.type === 'session.ended' || item.event.type === 'session.unbound')
      .map((item) => item.at);
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

/**
 * Where each session with activity served the task: its windows, from the start
 * of the task to now, without the lost windows. Token buckets are counted in these.
 */
export function sessionSpans(input: EffortInput): Map<string, IntervalSet> {
  const startedAt = input.startedAt.toMillis();
  const now = input.now.toMillis();
  const lost = input.lost ?? IntervalSet.EMPTY;
  const spans = new Map<string, IntervalSet>();
  for (const [session, all] of bySession(prepare(input.activity))) {
    const windows = sessionWindows(all) ?? [{ start: -Infinity, end: Infinity }];
    const clipped = windows
      .map((window) => ({ start: Math.max(window.start, startedAt), end: Math.min(window.end, now) }))
      .filter((window) => window.end > window.start)
      .map((window) => interval(window.start, window.end));
    spans.set(session, IntervalSet.of(clipped).minus(lost));
  }
  return spans;
}

function splitManual(
  records: readonly ManualTime[],
  lost: IntervalSet,
): {
  agentIntervals: IntervalSet;
  userIntervals: IntervalSet;
  agentWithoutTime: Duration;
  userWithoutTime: Duration;
  /** Manual agent time as agent work: each record on its own, timed ones without the lost windows. */
  agentWork: Duration;
} {
  const interval = (record: ManualTime) => IntervalSet.of([record.interval()].filter((v) => v !== undefined)).minus(lost);
  const timed = (kind: 'user' | 'agent'): IntervalSet =>
    IntervalSet.of(
      records
        .filter((record) => record.kind === kind && record.at !== undefined)
        .flatMap((record) => interval(record).intervals),
    );
  const untimed = (kind: 'user' | 'agent'): Duration =>
    Duration.sum(records.filter((record) => record.kind === kind && record.at === undefined).map((r) => r.duration));
  return {
    agentIntervals: timed('agent'),
    userIntervals: timed('user'),
    agentWithoutTime: untimed('agent'),
    userWithoutTime: untimed('user'),
    agentWork: Duration.sum(
      records
        .filter((record) => record.kind === 'agent')
        .map((record) => (record.at === undefined ? record.duration : interval(record).total)),
    ),
  };
}

/** The timeline without the lost windows: every agent, the user, each session and the doubts. */
function withoutLost(timeline: Timeline, lost: IntervalSet): Timeline {
  if (lost.intervals.length === 0) {
    return timeline;
  }
  return {
    agents: new Map([...timeline.agents].map(([key, agent]) => [key, { ...agent, intervals: agent.intervals.minus(lost) }])),
    user: timeline.user.minus(lost),
    userBySession: new Map([...timeline.userBySession].map(([key, set]) => [key, set.minus(lost)])),
    bounds: {
      low: { agents: timeline.bounds.low.agents.minus(lost), user: timeline.bounds.low.user.minus(lost) },
      high: { agents: timeline.bounds.high.agents.minus(lost), user: timeline.bounds.high.user.minus(lost) },
    },
  };
}

function share(part: Duration, whole: Duration): number | undefined {
  return whole.millis === 0 ? undefined : part.millis / whole.millis;
}
