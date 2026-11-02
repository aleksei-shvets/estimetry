import type { Duration } from './duration.js';
import type { IntervalSet } from './interval-set.js';

/** Highest uncertainty, as a share of the fact, that still meets the accuracy target. */
export const UNCERTAINTY_TARGET = 0.05;

/** The fact of a task and how it was put together (design §4). */
export interface EffortReport {
  /** Union of all agent intervals plus manual agent time. */
  readonly agentTime: Duration;
  /** Union of the user's intervals across sessions plus manual user time. */
  readonly userTime: Duration;
  /** Agent time plus user time. */
  readonly fact: Duration;
  /** Time that heuristics, not events, decided on. */
  readonly uncertainty: Duration;
  /** Uncertainty divided by the fact; undefined while the fact is zero. */
  readonly uncertaintyShare: number | undefined;
  readonly exceedsUncertaintyTarget: boolean;
  /** How much of the fact comes from manual records. */
  readonly manualTime: Duration;
  readonly manualShare: number | undefined;
  /** Sum over agents of their own intervals; waiting for a foreground subagent counts once. */
  readonly agentWork: Duration;
  /** Agent work plus user time; only for tasks that ran in parallel mode. */
  readonly sequentialEquivalent: Duration | undefined;
  /** From the start of the task to now. */
  readonly calendar: Duration;
  readonly parallel: { readonly used: boolean; readonly maxAgents: number | undefined };
  /** Some subagent worked in the background: agents overlapped even without parallel mode. */
  readonly backgroundAgents: boolean;
  /** Measured intervals, without manual time; used to warn about overlapping manual records. */
  readonly measured: { readonly agent: IntervalSet; readonly user: IntervalSet };
}
