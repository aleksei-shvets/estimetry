import type { LostWindow } from '../estimate/lost-window.js';
import type { Extra } from '../measurement/extra.js';
import type { ManualTime } from '../measurement/manual-time.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { Task } from './task.js';

/** Records of a task recorded inside a window of lost work: what `--covers` may name and what stays counted. */
export interface RevisionCandidateRecords {
  /** Extra work recorded in the window, any category, with the id `--covers` names. */
  readonly extras: readonly { readonly id: string; readonly at: Timestamp; readonly extra: Extra }[];
  /** Manual time without a moment, recorded in the window: a revision does not take it out. */
  readonly untimedManual: readonly ManualTime[];
}

export function revisionCandidates(task: Task, window: LostWindow): RevisionCandidateRecords {
  return {
    extras: task.extraRecords.flatMap(({ id, at, extra }) => (id === undefined || at === undefined || !window.contains(at) ? [] : [{ id, at, extra }])),
    untimedManual: task.manualRecords
      .filter((record) => record.manual.at === undefined && record.recordedAt !== undefined && window.contains(record.recordedAt))
      .map((record) => record.manual),
  };
}
