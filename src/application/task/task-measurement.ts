import { measureEffort } from '../../domain/measurement/effort-calculator.js';
import type { ActivityEvent } from '../../domain/measurement/activity-events.js';
import type { EffortReport } from '../../domain/measurement/effort-report.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { Clock } from '../ports/clock.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { MeasurementSettings } from '../ports/measurement-settings.js';

/** Computes the fact of a task from its journal and records; shared by status, parallel mode and manual time. */
export class TaskMeasurement {
  constructor(
    private readonly journal: EventJournal,
    private readonly settings: MeasurementSettings,
    private readonly clock: Clock,
  ) {}

  /**
   * `activity` is the task's journal when the caller has already read it. A
   * closed task is measured up to its closing moment: later events do not count.
   */
  measure(task: Task, activity?: readonly ActivityEvent[]): EffortReport {
    const closedAt = task.closedAt;
    const now = closedAt ?? this.clock.now();
    const startedAt = task.startedAt;
    const all = startedAt ? (activity ?? this.journal.readActivity(task.id)) : [];
    return measureEffort({
      activity: closedAt === undefined ? all : all.filter((event) => Timestamp.parse(event.ts).toMillis() <= closedAt.toMillis()),
      startedAt: startedAt ?? now,
      manual: task.manualTime,
      parallel: task.parallelMode,
      policy: this.settings.idlePolicy(),
      now,
    });
  }
}
