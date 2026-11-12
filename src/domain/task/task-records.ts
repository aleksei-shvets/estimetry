import type { ExcludedArchives, SpentPolicy } from '../estimate/estimate-revision.js';
import type { Extra, ExtraCategory } from '../measurement/extra.js';
import type { ManualTime } from '../measurement/manual-time.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { RetroReason, TaskOutcome } from './task-events.js';
import type { TaskId } from './task-id.js';
import type { TaskType } from './task-type.js';

/*
 * What a task remembers of its closings, revisions, extra work, manual time and
 * retro, as the getters of Task give it: public, unlike the state that holds it.
 */

/** One closing of the task; `reopenedAt` is set when it was opened again. */
export interface TaskClosure {
  readonly at: Timestamp;
  readonly outcome: TaskOutcome;
  readonly spawned?: TaskId;
  readonly reopenedAt?: Timestamp;
  /** When `task.closed` was written; `at` may be backdated. Absent in snapshots written before it was kept. */
  readonly recordedAt?: Timestamp;
}

/** One revision of the estimate, as the task remembers it. */
export interface TaskRevision {
  /** Id of the `task.estimate-revised` event. */
  readonly id: string;
  readonly at: Timestamp;
  readonly lostFrom?: Timestamp;
  readonly reason: string;
  readonly category?: ExtraCategory;
  readonly spent?: SpentPolicy;
  /** Most likely hours before calibration, of the estimate before and after; absent before for a task estimated after its start. */
  readonly baseLikelyBefore?: number;
  readonly baseLikelyAfter: number;
  /** Task type of the estimate before and after; absent in snapshots of schema 2. */
  readonly typeBefore?: TaskType;
  readonly typeAfter?: TaskType;
  /** Ids of the events of extra work the revision covers. */
  readonly covers: readonly string[];
  readonly excluded?: readonly ExcludedArchives[];
}

/** Extra work with the id and time of its event, for `--covers`; both absent when the snapshot did not keep them. */
export interface ExtraRecord {
  readonly id?: string;
  readonly at?: Timestamp;
  readonly extra: Extra;
}

/** Manual time with the moment the record was made, absent when the snapshot did not keep it. */
export interface ManualRecord {
  readonly manual: ManualTime;
  readonly recordedAt?: Timestamp;
}

/** The retro as the task remembers it; `recordedAt` tells whether it predates a reopening. */
export interface TaskRetro {
  readonly reasons: readonly RetroReason[];
  readonly lesson: string;
  readonly recordedAt: Timestamp;
}
