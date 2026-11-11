import { InvalidValue } from '../shared/domain-error.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { TaskClosed, TaskOutcome } from './task-events.js';
import { closureOf } from './task-snapshot.js';
import type { TaskState } from './task-state.js';
import type { TaskId } from './task-id.js';

/** How a task closes: the moment, the outcome and the task that took over the rest of the work. */
export interface ClosingInput {
  readonly at: Timestamp;
  readonly outcome: TaskOutcome;
  readonly spawned?: TaskId;
}

/** The moment the task was last reopened, if it ever was. */
export function lastReopening(state: TaskState): Timestamp | undefined {
  return state.closures.flatMap((closure) => (closure.reopenedAt === undefined ? [] : [closure.reopenedAt])).at(-1);
}

/**
 * A closing may be backdated, but not before the start nor before anything the
 * task already knows of: a parallel period or a record after the end would contradict it.
 */
export function checkClosingMoment(state: TaskState, startedAt: Timestamp, at: Timestamp, now: Timestamp): void {
  if (at.toMillis() > now.toMillis()) {
    throw new InvalidValue(`closing time must not be in the future (${at.toISOString()})`);
  }
  if (at.toMillis() < startedAt.toMillis()) {
    throw new InvalidValue(`closing time ${at.toISOString()} is before the start (${startedAt.toISOString()})`);
  }
  if (at.toMillis() < state.lastEventAt.toMillis()) {
    throw new InvalidValue(`closing time ${at.toISOString()} is before the last record of the task (${state.lastEventAt.toISOString()})`);
  }
}

export function closedData(input: ClosingInput): TaskClosed['data'] {
  return { at: input.at.toISOString(), outcome: input.outcome, ...(input.spawned === undefined ? {} : { spawned: input.spawned.toString() }) };
}

/** Ends the last period of parallel mode: a disabling always, the closing of the task only an open one. */
export function endParallelMode(state: TaskState, at: string, always = false): void {
  const last = state.parallelMode.at(-1);
  if (last && (always || last.disabledAt === undefined)) {
    state.parallelMode[state.parallelMode.length - 1] = { ...last, disabledAt: at };
  }
}

export function applyClosed(state: TaskState, event: TaskClosed): void {
  endParallelMode(state, event.data.at);
  state.status = 'closed';
  state.closures.push(closureOf({ ...event.data, recordedAt: event.ts }));
}

/** The last closing is reopened at `ts`; the task is in progress again. */
export function applyReopened(state: TaskState, ts: Timestamp): void {
  const last = state.closures.at(-1);
  if (last) {
    state.closures[state.closures.length - 1] = { ...last, reopenedAt: ts };
  }
  state.status = 'in-progress';
}
