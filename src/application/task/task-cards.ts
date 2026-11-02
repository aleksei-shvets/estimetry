import { buildCard, type Card } from '../../domain/card/card.js';
import { calibrate, type Calibration } from '../../domain/calibration/calibration.js';
import { partFacts, type CompletionPoint, type PlanPoint } from '../../domain/progress/part-facts.js';
import type { ProgressRecord } from '../../domain/progress/progress-records.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { CalibrationSettings } from '../ports/calibration-settings.js';
import type { CalibrationStore } from '../ports/calibration-store.js';
import type { CardStore } from '../ports/card-store.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { TaskMeasurement } from './task-measurement.js';

/** Cards of closed tasks and the calibration derived from them: both are rebuilt from journals. */
export class TaskCards {
  constructor(
    private readonly journal: Pick<EventJournal, 'readAll'>,
    private readonly measurement: TaskMeasurement,
    private readonly cards: CardStore,
    private readonly calibration: CalibrationStore,
    private readonly settings: CalibrationSettings,
  ) {}

  /** The card of a closed task, built from its journal alone. */
  build(task: Task): Card {
    const { activity, records } = this.journal.readAll(task.id);
    const report = this.measurement.measure(task, activity);
    const startedAt = task.startedAt as Timestamp;
    const closedAt = task.closedAt as Timestamp;
    return buildCard({
      task,
      report,
      partFacts: partFacts({
        estimate: task.estimate,
        startedAt,
        closedAt,
        points: planPoints(records),
        completions: completions(records),
        measured: report.measured,
        manual: task.manualTime,
      }),
      records,
      hasActivity: activity.length > 0,
    });
  }

  /** Writes the card of a closed task, removes the card of any other. */
  refresh(task: Task): Card | undefined {
    if (task.status !== 'closed') {
      this.cards.remove(task.id.toString());
      return undefined;
    }
    const card = this.build(task);
    this.cards.write(card);
    return card;
  }

  recalculate(): Calibration {
    return this.calibration.recalculate(() => calibrate(this.cards.list(), { minTasks: this.settings.minTasks() }));
  }
}

/** Snapshots of the plan by project: at the start, at every checkpoint, at the closing. */
function planPoints(records: readonly ProgressRecord[]): PlanPoint[] {
  const points: PlanPoint[] = [];
  for (const record of records) {
    const at = Timestamp.parse(record.ts);
    if (record.type === 'plan.started' || record.type === 'plan.closing') {
      for (const project of record.data.projects) {
        if (project.changes !== undefined) {
          points.push({ at, project: project.project, changes: project.changes });
        }
      }
    } else if (record.type === 'checkpoint.recorded' && record.data.plan !== undefined && record.project !== undefined) {
      points.push({ at, project: record.project, changes: record.data.plan });
    }
  }
  return points;
}

/** Exact completions only: an approximate moment says nothing about when the work was done. */
function completions(records: readonly ProgressRecord[]): CompletionPoint[] {
  return records.flatMap((record) =>
    record.type === 'change.completed' && !record.data.approximate
      ? [{ at: Timestamp.parse(record.data.completedAt), project: record.data.project, change: record.data.change }]
      : [],
  );
}
