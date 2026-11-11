import type { Estimate } from '../estimate/estimate.js';
import type { ManualTime } from '../measurement/manual-time.js';
import type { ParallelModeChange } from '../measurement/parallel-mode.js';
import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';
import { ParallelModeConflict, UnknownEstimatePart } from './task-errors.js';
import type { TaskState } from './task-state.js';

/** Manual time names a part of the estimate if any, does not end in the future and fits after the start. */
export function checkManualTime(estimate: Estimate | undefined, manual: ManualTime, startedAt: Timestamp, now: Timestamp): void {
  if (manual.part !== undefined && !(estimate?.hasPart(manual.part) ?? false)) {
    throw new UnknownEstimatePart([manual.part], estimate?.partIds ?? []);
  }
  if (manual.at === undefined) {
    return;
  }
  if (manual.at.toMillis() > now.toMillis()) {
    throw new InvalidValue(`manual time cannot end in the future (${manual.at.toISOString()})`);
  }
  // Time before the start is not the task's, so a record must fit after it.
  const begins = Timestamp.fromMillis(manual.at.toMillis() - manual.duration.millis);
  if (begins.toMillis() < startedAt.toMillis()) {
    throw new InvalidValue(
      `manual time must lie after the task started (${startedAt.toISOString()}), but ${manual.duration.minutes}m ending ${manual.at.toISOString()} starts at ${begins.toISOString()}`,
    );
  }
}

/** True while the last period of parallel mode is open. */
export function isParallel(state: TaskState): boolean {
  return state.parallelMode.at(-1)?.disabledAt === undefined && state.parallelMode.length > 0;
}

/** Parallel mode switches on only when it is off and names only parts of the current estimate; it switches off only when on. */
export function checkParallelSwitch(state: TaskState, on: boolean, change?: ParallelModeChange): void {
  if (isParallel(state) === on) {
    throw new ParallelModeConflict(state.id.toString(), on);
  }
  const known = state.estimate?.parts.map((part) => part.id) ?? [];
  const unknown = (change?.parts ?? []).filter((part) => !known.includes(part));
  if (unknown.length > 0) {
    throw new UnknownEstimatePart(unknown, known);
  }
}
