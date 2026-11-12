import type { PlanExclusions } from '../../domain/progress/plan-exclusions.js';
import type { TaskStatus } from '../../domain/task/task-status.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';

/** What the hook receiver needs of a task, read from its snapshot without checking the journal. */
export interface TaskSummary {
  readonly id: TaskId;
  readonly title: string;
  readonly status: TaskStatus;
  readonly startedAt?: Timestamp;
  readonly projects: readonly ProjectId[];
  /** Groups of the current estimate's parts: an archived change of one of them is a completion of the task. */
  readonly groups?: readonly string[];
  /** The changes of the task as its snapshot keeps them (`Task.changes`): they pick its working copy. */
  readonly changes?: readonly string[];
  /** Archived changes revisions took out of the plan: never a completion. */
  readonly exclusions?: PlanExclusions;
}

export interface TaskStatusReader {
  summary(task: TaskId): TaskSummary | undefined;
  inProgress(project: ProjectId): TaskSummary[];
}
