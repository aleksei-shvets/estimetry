import { measureEffort, sessionSpans, type EffortInput } from '../../domain/measurement/effort-calculator.js';
import type { ActivityEvent } from '../../domain/measurement/activity-events.js';
import type { EffortReport } from '../../domain/measurement/effort-report.js';
import { Interval } from '../../domain/measurement/interval.js';
import { IntervalSet } from '../../domain/measurement/interval-set.js';
import type { ProgressRecord } from '../../domain/progress/progress-records.js';
import { logBoundaries, sessionLogs, type LogSession, type SessionLog } from '../../domain/progress/session-log.js';
import type { LogBoundaries } from '../../domain/measurement/log-boundaries.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import { taskUsage, type TaskUsage } from '../../domain/usage/task-usage.js';
import type { Clock } from '../ports/clock.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { MeasurementSettings } from '../ports/measurement-settings.js';

/** A task's journal as one read gives it: the fact needs both activity and the records of session logs. */
export interface JournalContent {
  readonly activity: readonly ActivityEvent[];
  readonly records: readonly ProgressRecord[];
}

type Options = { readonly lost?: readonly { readonly from: Timestamp; readonly to: Timestamp }[]; readonly until?: Timestamp };

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
  measure(task: Task, journal?: JournalContent): EffortReport {
    return this.report(task, journal);
  }

  /**
   * The fact compared with the estimate: without the windows of work thrown
   * away by revisions (estimate-revision spec). Equal to `measure` without them.
   */
  counted(task: Task, journal?: JournalContent): EffortReport {
    return this.report(task, journal, { lost: task.lostWindows });
  }

  /**
   * The counted fact as it stood at a revision: activity and manual records up
   * to that moment, without the windows of lost work that ended by then.
   */
  countedAt(task: Task, at: Timestamp, journal?: JournalContent): EffortReport {
    return this.report(task, journal, {
      lost: task.lostWindows.filter((window) => window.endsBy(at)),
      until: at,
    });
  }

  /** The fact without one window of lost work: the work of that window is the difference with `measure`. */
  without(task: Task, window: { readonly from: Timestamp; readonly to: Timestamp }, journal?: JournalContent): EffortReport {
    return this.report(task, journal, { lost: [window] });
  }

  /**
   * Tokens and cost of the task from the logs of its sessions, up to the closing
   * and without the windows of lost work; undefined when no session has a log.
   */
  usage(task: Task, journal?: JournalContent): TaskUsage | undefined {
    const content = this.content(task, journal);
    const input = this.input(task, content, { lost: task.lostWindows });
    return taskUsage({ logs: this.logs(task, content.records).sessions, spans: sessionSpans(input) });
  }

  private content(task: Task, journal: JournalContent | undefined): JournalContent {
    return task.startedAt ? (journal ?? this.journal.readAll(task.id)) : { activity: [], records: [] };
  }

  /**
   * Logs of the task's sessions; records written while the task stayed closed
   * do not count. Merged once per read of the journal: a card measures the same
   * content several times.
   */
  private logs(task: Task, records: readonly ProgressRecord[]): { sessions: Map<string, SessionLog>; boundaries: Map<string, LogBoundaries> } {
    const cached = this.merged.get(records);
    if (cached !== undefined && cached.closures === task.closures.length) {
      return cached;
    }
    const sessions = sessionLogs(
      records.filter((record): record is LogSession => record.type === 'log.session'),
      task.closures,
    );
    const merged = { sessions, boundaries: logBoundaries(sessions), closures: task.closures.length };
    this.merged.set(records, merged);
    return merged;
  }

  private readonly merged = new WeakMap<readonly ProgressRecord[], { sessions: Map<string, SessionLog>; boundaries: Map<string, LogBoundaries>; closures: number }>();

  private report(task: Task, journal: JournalContent | undefined, options: Options = {}): EffortReport {
    const content = this.content(task, journal);
    return measureEffort({ ...this.input(task, content, options), logs: this.logs(task, content.records).boundaries });
  }

  private input(task: Task, content: JournalContent, options: Options): EffortInput {
    const closedAt = options.until ?? task.closedAt;
    const now = closedAt ?? this.clock.now();
    const startedAt = task.startedAt;
    const all = content.activity;
    const until = options.until;
    const manual =
      until === undefined
        ? task.manualTime
        : task.manualRecords
            .filter(({ manual: record, recordedAt }) => {
              return (recordedAt === undefined || recordedAt.toMillis() <= until.toMillis()) && (record.at === undefined || record.at.toMillis() <= until.toMillis());
            })
            .map(({ manual: record }) => record);
    const lost = options.lost ?? [];
    return {
      activity: closedAt === undefined ? all : all.filter((event) => Timestamp.parse(event.ts).toMillis() <= closedAt.toMillis()),
      startedAt: startedAt ?? now,
      manual,
      parallel: task.parallelMode,
      policy: this.settings.idlePolicy(),
      now,
      ...(lost.length > 0 ? { lost: IntervalSet.of(lost.map((window) => Interval.of(window.from, window.to))) } : {}),
    };
  }
}
