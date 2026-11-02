import { measureEffort } from '../../domain/measurement/effort-calculator.js';
import type { ActivityEvent } from '../../domain/measurement/activity-events.js';
import type { EffortReport } from '../../domain/measurement/effort-report.js';
import { Interval } from '../../domain/measurement/interval.js';
import { IntervalSet } from '../../domain/measurement/interval-set.js';
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
    return this.report(task, activity);
  }

  /**
   * The fact compared with the estimate: without the windows of work thrown
   * away by revisions (estimate-revision spec). Equal to `measure` without them.
   */
  counted(task: Task, activity?: readonly ActivityEvent[]): EffortReport {
    return this.report(task, activity, { lost: task.lostWindows });
  }

  /**
   * The counted fact as it stood at a revision: activity and manual records up
   * to that moment, without the windows of lost work that ended by then.
   */
  countedAt(task: Task, at: Timestamp, activity?: readonly ActivityEvent[]): EffortReport {
    return this.report(task, activity, {
      lost: task.lostWindows.filter((window) => window.to.toMillis() <= at.toMillis()),
      until: at,
    });
  }

  /** The fact without one window of lost work: the work of that window is the difference with `measure`. */
  without(task: Task, window: { readonly from: Timestamp; readonly to: Timestamp }, activity?: readonly ActivityEvent[]): EffortReport {
    return this.report(task, activity, { lost: [window] });
  }

  private report(
    task: Task,
    activity: readonly ActivityEvent[] | undefined,
    options: { readonly lost?: readonly { readonly from: Timestamp; readonly to: Timestamp }[]; readonly until?: Timestamp } = {},
  ): EffortReport {
    const closedAt = options.until ?? task.closedAt;
    const now = closedAt ?? this.clock.now();
    const startedAt = task.startedAt;
    const all = startedAt ? (activity ?? this.journal.readActivity(task.id)) : [];
    const until = options.until;
    const manual =
      until === undefined
        ? task.manualTime
        : task.manualRecords
            .filter(({ manual: record, recordedAt }) => {
              const made = recordedAt === '' ? undefined : Timestamp.parse(recordedAt);
              return (made === undefined || made.toMillis() <= until.toMillis()) && (record.at === undefined || record.at.toMillis() <= until.toMillis());
            })
            .map(({ manual: record }) => record);
    const lost = options.lost ?? [];
    return measureEffort({
      activity: closedAt === undefined ? all : all.filter((event) => Timestamp.parse(event.ts).toMillis() <= closedAt.toMillis()),
      startedAt: startedAt ?? now,
      manual,
      parallel: task.parallelMode,
      policy: this.settings.idlePolicy(),
      now,
      ...(lost.length > 0 ? { lost: IntervalSet.of(lost.map((window) => Interval.of(window.from, window.to))) } : {}),
    });
  }
}
