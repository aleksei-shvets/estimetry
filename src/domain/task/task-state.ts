import type { Estimate } from '../estimate/estimate.js';
import type { ExcludedArchives, SpentPolicy } from '../estimate/estimate-revision.js';
import type { Extra, ExtraCategory } from '../measurement/extra.js';
import type { ManualTime } from '../measurement/manual-time.js';
import type { ParallelPeriod } from '../measurement/parallel-mode.js';
import { ProjectId } from '../project/project-id.js';
import { Author } from '../shared/author.js';
import { Timestamp } from '../shared/timestamp.js';
import type { RetroReason, TaskCreated, TaskOutcome } from './task-events.js';
import { TaskId } from './task-id.js';
import type { TaskStatus } from './task-status.js';
import { TaskType } from './task-type.js';

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

/** State of the aggregate in value objects; strings are parsed only from events and snapshots. */
export interface TaskState {
  id: TaskId;
  title: string;
  type: TaskType;
  ticket: string | undefined;
  status: TaskStatus;
  estimated: boolean;
  projects: ProjectId[];
  author: Author;
  createdAt: Timestamp;
  startedAt: Timestamp | undefined;
  estimate: Estimate | undefined;
  manual: ManualRecord[];
  extras: ExtraRecord[];
  parallelMode: ParallelPeriod[];
  spawnedFrom: TaskId | undefined;
  closures: TaskClosure[];
  retro: TaskRetro | undefined;
  /** Latest moment the aggregate knows of: event times and ends of manual time. */
  lastEventAt: Timestamp;
  firstEstimate: Estimate | undefined;
  estimatedAfterStart: boolean;
  revisions: TaskRevision[];
  /** When manual time of an estimate part was last recorded: a revision cannot start before it. */
  lastPartRecordAt: Timestamp | undefined;
}

export function later(a: Timestamp, b: Timestamp): Timestamp {
  return b.toMillis() > a.toMillis() ? b : a;
}

/** The state of a task right after `task.created`. */
export function initialState(event: TaskCreated): TaskState {
  const ts = Timestamp.parse(event.ts);
  return {
    id: TaskId.parse(event.task),
    title: event.data.title,
    type: TaskType.restore(event.data.taskType),
    ticket: event.data.ticket,
    status: 'new',
    estimated: false,
    projects: event.project === undefined ? [] : [ProjectId.parse(event.project)],
    author: Author.of(event.author),
    createdAt: ts,
    startedAt: undefined,
    estimate: undefined,
    manual: [],
    extras: [],
    parallelMode: [],
    spawnedFrom: event.data.spawnedFrom === undefined ? undefined : TaskId.parse(event.data.spawnedFrom),
    closures: [],
    retro: undefined,
    lastEventAt: ts,
    firstEstimate: undefined,
    estimatedAfterStart: false,
    revisions: [],
    lastPartRecordAt: undefined,
  };
}
