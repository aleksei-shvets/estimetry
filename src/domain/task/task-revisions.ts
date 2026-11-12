import { Estimate } from '../estimate/estimate.js';
import type { EstimateRevision } from '../estimate/estimate-revision.js';
import { LostWindow } from '../estimate/lost-window.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { TaskEstimateRevised } from './task-events.js';
import { revisionOf } from './task-snapshot.js';
import { later, type TaskState } from './task-state.js';
import { TaskType } from './task-type.js';

/** What a check of a revision needs besides the state: the start and moments the aggregate derives. */
export interface RevisionMoments {
  readonly startedAt: Timestamp;
  /** The moment of the event: a revision is never in the future. */
  readonly now: Timestamp;
  readonly lastReopening: Timestamp | undefined;
}

/** The earliest a window of lost work may start: the latest of the start, the previous revision and the last reopening. */
export function lostWindowFloor(state: TaskState, lastReopening: Timestamp | undefined): Timestamp | undefined {
  const moments = [state.startedAt, state.revisions.at(-1)?.at, lastReopening].filter((v): v is Timestamp => v !== undefined);
  return moments.length === 0 ? undefined : moments.reduce(later);
}

/** Windows of work thrown away by revisions with `exclude`. */
export function lostWindowsOf(state: TaskState): LostWindow[] {
  return state.revisions.flatMap((r) => (r.spent === 'exclude' && r.lostFrom !== undefined ? [LostWindow.of(r.lostFrom, r.at)] : []));
}

/**
 * The data of `task.estimate-revised` for a task in progress (estimate-revision
 * spec). The moment may be backdated, but not before anything that refers to the old plan.
 */
export function revisedData(state: TaskState, revision: EstimateRevision, moments: RevisionMoments): TaskEstimateRevised['data'] {
  const firstOne = state.estimate === undefined;
  checkOptions(revision, firstOne);
  const at = revision.at;
  if (at.toMillis() > moments.now.toMillis()) {
    throw new InvalidValue(`the revision moment must not be in the future (${at.toISOString()})`);
  }
  const parallelEnd = state.parallelMode.at(-1)?.disabledAt;
  const floors: [string, Timestamp | undefined][] = [
    ['the start', moments.startedAt],
    ['the previous revision', state.revisions.at(-1)?.at],
    ['the last reopening', moments.lastReopening],
    ['the end of parallel mode', parallelEnd],
    ['the last manual time of an estimate part', state.lastPartRecordAt],
  ];
  for (const [what, floor] of floors) {
    if (floor !== undefined && at.toMillis() < floor.toMillis()) {
      throw new InvalidValue(`the revision moment ${at.toISOString()} is before ${what} (${floor.toISOString()})`);
    }
  }
  const lostFrom = revision.spent === 'exclude' ? checkedLostFrom(state, revision, moments, floors.slice(0, 3)) : revision.lostFrom;
  checkCovers(state, revision);
  return {
    estimate: revision.estimate.toData(),
    ...(revision.type === undefined ? {} : { taskType: revision.type }),
    reason: revision.reason.value,
    ...(revision.category === undefined || firstOne ? {} : { category: revision.category }),
    ...(revision.spent === undefined || firstOne ? {} : { spent: revision.spent }),
    at: at.toISOString(),
    ...(lostFrom === undefined || firstOne ? {} : { lostFrom: lostFrom.toISOString() }),
    covers: [...revision.covers],
    ...(revision.excluded.length === 0 || firstOne ? {} : { excluded: revision.excluded }),
  };
}

function checkOptions(revision: EstimateRevision, firstOne: boolean): void {
  if (!firstOne && (revision.spent === undefined || revision.category === undefined)) {
    throw new InvalidValue('a revision needs --spent include or --spent exclude, and --category');
  }
  if (firstOne && (revision.spent !== undefined || revision.lostFrom !== undefined || revision.covers.length > 0)) {
    throw new InvalidValue('the task has no estimate yet, so this is its first one: --spent, --lost-from and --covers do not apply');
  }
  if (revision.covers.length > 0 && revision.spent !== 'exclude') {
    throw new InvalidValue(
      '--covers goes only with --spent exclude: with include nothing is lost, and the covered extra work would leave calibration',
    );
  }
}

/** The start of the lost window: given or the floor, not before the start, the previous revision or the reopening. */
function checkedLostFrom(
  state: TaskState,
  revision: EstimateRevision,
  moments: RevisionMoments,
  floors: readonly [string, Timestamp | undefined][],
): Timestamp {
  const lostFrom = revision.lostFrom ?? lostWindowFloor(state, moments.lastReopening) ?? moments.startedAt;
  for (const [what, floor] of floors) {
    if (floor !== undefined && lostFrom.toMillis() < floor.toMillis()) {
      throw new InvalidValue(`--lost-from ${lostFrom.toISOString()} is before ${what} (${floor.toISOString()})`);
    }
  }
  if (lostFrom.toMillis() >= revision.at.toMillis()) {
    throw new InvalidValue('the window of lost work is empty: --lost-from must be before the revision moment');
  }
  return lostFrom;
}

/** `--covers` names extra work of this task that no other revision covers. */
function checkCovers(state: TaskState, revision: EstimateRevision): void {
  const known = new Set(state.extras.flatMap((record) => (record.id === undefined ? [] : [record.id])));
  const unknown = revision.covers.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new InvalidValue(`--covers names no extra work of this task: ${unknown.join(', ')}`);
  }
  const covered = new Set(state.revisions.filter((r) => r.spent === 'exclude').flatMap((r) => r.covers));
  const twice = revision.covers.filter((id) => covered.has(id));
  if (twice.length > 0) {
    throw new InvalidValue(`--covers names extra work another revision already covers: ${twice.join(', ')}`);
  }
}

/** The first estimate after the start is no revision; any later one is, with the plan before and after it. */
export function applyRevision(state: TaskState, event: TaskEstimateRevised): TaskState {
  const before = state.estimate;
  const after = Estimate.fromData(event.data.estimate);
  const plan: TaskState = {
    ...state,
    estimate: after,
    estimated: true,
    // Revisions add their changes: a change a revision dropped stays one of the task.
    changes: [...new Set([...state.changes, ...after.groups])],
    ...(event.data.taskType === undefined ? {} : { type: TaskType.restore(event.data.taskType) }),
  };
  if (before === undefined) {
    return { ...plan, estimatedAfterStart: true };
  }
  const revision = revisionOf({
    id: event.id,
    at: event.data.at,
    ...(event.data.lostFrom === undefined ? {} : { lostFrom: event.data.lostFrom }),
    reason: event.data.reason,
    ...(event.data.category === undefined ? {} : { category: event.data.category }),
    ...(event.data.spent === undefined ? {} : { spent: event.data.spent }),
    baseLikelyBefore: before.baseLikely,
    baseLikelyAfter: after.baseLikely,
    typeBefore: state.type.value,
    typeAfter: event.data.taskType ?? state.type.value,
    covers: [...event.data.covers],
    ...(event.data.excluded === undefined ? {} : { excluded: event.data.excluded }),
  });
  return { ...plan, firstEstimate: state.firstEstimate ?? before, revisions: [...state.revisions, revision] };
}
