import { Timestamp } from '../shared/timestamp.js';
import { Interval } from './interval.js';
import { IntervalSet } from './interval-set.js';

/*
 * The measured timeline of a task and the helpers its parts share. Times are
 * milliseconds inside the measurement only.
 */

/** Agent id of the main agent of a session. */
export const MAIN = '';

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
  /** The same measurement without the counted doubtful stretches and with the discarded ones. */
  readonly bounds: { readonly low: Bound; readonly high: Bound };
}

/** All agents and the user under one bound of the fact (effort-metrics, uncertainty). */
export interface Bound {
  readonly agents: IntervalSet;
  readonly user: IntervalSet;
}

/** Key of an agent of a session; the main agent has an empty agent part. */
export function key(session: string, agent: string): string {
  return `${session}/${agent}`;
}

export function push<T>(groups: Map<string, T[]>, groupKey: string, item: T): void {
  const group = groups.get(groupKey);
  if (group) {
    group.push(item);
  } else {
    groups.set(groupKey, [item]);
  }
}

export function union(sets: readonly IntervalSet[]): IntervalSet {
  return IntervalSet.of(sets.flatMap((set) => set.intervals));
}

/** An interval between two moments in milliseconds. */
export function interval(start: number, end: number): Interval {
  return Interval.of(Timestamp.fromMillis(start), Timestamp.fromMillis(end));
}
