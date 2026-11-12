import type { Estimate } from '../estimate/estimate.js';
import type { ParallelPeriod } from '../measurement/parallel-mode.js';
import { ProjectId } from '../project/project-id.js';
import { Author } from '../shared/author.js';
import { Timestamp } from '../shared/timestamp.js';
import type { TaskCreated } from './task-events.js';
import type { ExtraRecord, ManualRecord, TaskClosure, TaskRetro, TaskRevision } from './task-records.js';
import { TaskId } from './task-id.js';
import type { TaskStatus } from './task-status.js';
import { TaskType } from './task-type.js';

/**
 * State of the aggregate in value objects; strings are parsed only from events
 * and snapshots. Immutable: applying an event gives a new state, so nothing
 * outside the aggregate can change the one it holds.
 */
export interface TaskState {
  readonly id: TaskId;
  readonly title: string;
  readonly type: TaskType;
  readonly ticket: string | undefined;
  readonly status: TaskStatus;
  readonly estimated: boolean;
  readonly projects: readonly ProjectId[];
  readonly author: Author;
  readonly createdAt: Timestamp;
  readonly startedAt: Timestamp | undefined;
  readonly estimate: Estimate | undefined;
  readonly manual: readonly ManualRecord[];
  readonly extras: readonly ExtraRecord[];
  readonly parallelMode: readonly ParallelPeriod[];
  readonly spawnedFrom: TaskId | undefined;
  readonly closures: readonly TaskClosure[];
  readonly retro: TaskRetro | undefined;
  /** Latest moment the aggregate knows of: event times and ends of manual time. */
  readonly lastEventAt: Timestamp;
  readonly firstEstimate: Estimate | undefined;
  readonly estimatedAfterStart: boolean;
  readonly revisions: readonly TaskRevision[];
  /** When manual time of an estimate part was last recorded: a revision cannot start before it. */
  readonly lastPartRecordAt: Timestamp | undefined;
  /** The changes of the task (plan-progress spec): groups of the estimate before the start and of every revision after it. */
  readonly changes: readonly string[];
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
    changes: [],
  };
}
