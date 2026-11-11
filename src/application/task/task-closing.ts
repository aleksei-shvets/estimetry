import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import type { ClosingFollowUp } from './closing-follow-up.js';
import type { ClosingRecords } from './closing-records.js';

/**
 * Steps around `task.closed`, shared by `emt close` and `emt renegotiate`:
 * `prepare` before the event is written, `finish` after it.
 */
export class TaskClosing {
  constructor(
    private readonly records: ClosingRecords,
    private readonly followUp: ClosingFollowUp,
  ) {}

  /** Records the logs, the code volume and the plan; returns warnings of logs that could not be imported. */
  prepare(task: Task, recordedAt: Timestamp, where: WorkingCopy = {}): string[] {
    return this.records.prepare(task, recordedAt, where);
  }

  /** Releases the sessions, drops a pending proposal, writes the card and the calibration; returns warnings of failed steps. */
  finish(task: Task): string[] {
    return this.followUp.finish(task);
  }
}
