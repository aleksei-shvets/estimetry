import type { ActivityEvent } from '../../domain/measurement/activity-events.js';
import type { ProgressRecord } from '../../domain/progress/progress-records.js';
import type { TaskId } from '../../domain/task/task-id.js';

/** Activity events of a task's journal. They never touch the task's version or lock. */
export interface EventJournal {
  /**
   * Appends to the journal of `event.task`.
   * @throws InvalidActivityEvent if the event breaks the contract.
   */
  append(event: ActivityEvent): void;
  /** Activity events in journal order; aggregate events and broken records are skipped. */
  readActivity(task: TaskId): ActivityEvent[];
  /** Checkpoints and commits of the task; they never count in its version. */
  appendRecord(record: ProgressRecord): void;
  readRecords(task: TaskId): ProgressRecord[];
  /** The journal of sessions without a task in `project`: events and records with no task in the envelope. */
  appendUnassigned(project: string, entry: ActivityEvent | ProgressRecord): void;
  readUnassigned(project: string): ActivityEvent[];
}
