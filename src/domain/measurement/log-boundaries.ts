/**
 * What a session log tells the calculator: when turns of the main agent began
 * and ended, and when each subagent wrote records (effort-metrics, refining by
 * the session log). Times are milliseconds since the epoch.
 */
export interface LogBoundaries {
  /** Sorted by start. */
  readonly turns: readonly { readonly start: number; readonly end: number }[];
  /** Stretches of records by subagent id. */
  readonly agents: ReadonlyMap<string, readonly (readonly [number, number])[]>;
}
