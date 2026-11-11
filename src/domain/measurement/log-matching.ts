import type { LogBoundaries } from './log-boundaries.js';

/** A turn of the log matches a turn of the hooks when it holds the hooks' event within this tolerance. */
export const LOG_MATCH_MS = 5_000;

/** The turn of the log that holds `at`, the latest one if several do. */
export function logTurnAt(log: LogBoundaries | undefined, at: number): { readonly start: number; readonly end: number } | undefined {
  if (log === undefined) {
    return undefined;
  }
  let found: { readonly start: number; readonly end: number } | undefined;
  for (const turn of log.turns) {
    if (turn.start - LOG_MATCH_MS > at) {
      break;
    }
    if (turn.end + LOG_MATCH_MS >= at) {
      found = turn;
    }
  }
  return found;
}

/**
 * Whether the log holds a subagent run: it has records from the run's last
 * event of the hooks (within the match tolerance) up to `next`. Records of
 * other runs only leave the run to the heuristics, as without a log.
 */
export function holdsRun(spans: readonly (readonly [number, number])[], last: number, next: number): boolean {
  return spans.some(([start, end]) => end + LOG_MATCH_MS >= last && start < next);
}

/** The last record of a subagent before `bound`, from the stretches of its log; undefined when it has none there. */
export function lastRecordBefore(spans: readonly (readonly [number, number])[], bound: number): number | undefined {
  let last: number | undefined;
  for (const [start, end] of spans) {
    if (start < bound) {
      last = Math.max(last ?? start, Math.min(end, bound));
    }
  }
  return last;
}
