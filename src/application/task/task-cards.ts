import { buildCard, type Card } from '../../domain/card/card.js';
import { CardsTooNew } from '../../domain/card/card-errors.js';
import { upgradeCardV1, type CardV1 } from '../../domain/card/card-v1.js';
import { calibrate, type Calibration } from '../../domain/calibration/calibration.js';
import type { EffortReport } from '../../domain/measurement/effort-report.js';
import { Interval } from '../../domain/measurement/interval.js';
import { IntervalSet } from '../../domain/measurement/interval-set.js';
import { partFacts, type CompletionPoint, type PlanPoint } from '../../domain/progress/part-facts.js';
import type { ProgressRecord } from '../../domain/progress/progress-records.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { Task } from '../../domain/task/task.js';
import type { CalibrationSettings } from '../ports/calibration-settings.js';
import type { CalibrationStore } from '../ports/calibration-store.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { CardStore } from '../ports/card-store.js';
import type { ErrorReporter } from '../ports/error-reporter.js';
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
    private readonly tasks: Pick<TaskRepository, 'find'>,
    private readonly errors: ErrorReporter,
    private readonly authors: AuthorProvider,
  ) {}

  /** The card of a closed task, built from its journal alone. */
  build(task: Task): Card {
    const { activity, records } = this.journal.readAll(task.id);
    const report = this.measurement.measure(task, activity);
    const counted = this.measurement.counted(task, activity);
    const startedAt = task.startedAt as Timestamp;
    const closedAt = task.closedAt as Timestamp;
    const last = task.revisions.at(-1);
    const numerator = (r: EffortReport) => (r.parallel.used && r.sequentialEquivalent !== undefined ? r.sequentialEquivalent : r.fact).minutes;
    return buildCard({
      task,
      report,
      counted,
      partFacts: partFacts({
        estimate: task.estimate,
        startedAt,
        closedAt,
        points: planPoints(records),
        completions: completions(records),
        measured: counted.measured,
        manual: task.manualTime,
        manualRecordedAt: task.manualRecords.map((record) => (record.recordedAt === '' ? undefined : Timestamp.parse(record.recordedAt))),
        lost: IntervalSet.of(task.lostWindows.map((window) => Interval.of(window.from, window.to))),
        ...(last === undefined ? {} : { revision: { id: last.id, at: Timestamp.parse(last.at), exclusions: task.planExclusions } }),
      }),
      revisionFacts: task.revisions.map((revision) => {
        const at = Timestamp.parse(revision.at);
        const countedAt = Math.round(this.measurement.countedAt(task, at, activity).fact.minutes);
        if (revision.spent !== 'exclude' || revision.lostFrom === undefined) {
          return { countedAtMinutes: countedAt, lostMinutes: 0 };
        }
        const without = this.measurement.without(task, { from: Timestamp.parse(revision.lostFrom), to: at }, activity);
        return { countedAtMinutes: countedAt, lostMinutes: Math.max(0, Math.round(numerator(report) - numerator(without))) };
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

  /** The card of a closed task for `emt task show`: a card of an older schema is rebuilt and written. */
  cardOf(task: Task): Card {
    const stored = this.cards.read(task.id.toString());
    if (stored?.schema === 'current') {
      return stored.card;
    }
    // A newer card stays as it is: this binary shows its own reading of the journal.
    return stored?.schema === 'newer' ? this.build(task) : (this.refresh(task) ?? this.build(task));
  }

  /**
   * Calibration from every card. Cards of schema 1 are rebuilt from their
   * journals first; a card newer than this binary stops the recalculation.
   */
  recalculate(): Calibration {
    return this.calibration.recalculate(() => {
      const stored = this.cards.list();
      const newer = stored.flatMap((card) => (card.schema === 'newer' ? [card.task] : []));
      if (newer.length > 0) {
        const error = new CardsTooNew(newer);
        this.errors.report('calibration', error);
        throw error;
      }
      const cards = stored.map((card) => (card.schema === 'current' ? card.card : card.schema === 'v1' ? this.upgrade(card.card) : undefined));
      // A card that cannot be read even by its fields is left out, as a broken file is.
      return calibrate(
        cards.filter((card): card is Card => card !== undefined),
        { minTasks: this.settings.minTasks(), aliases: this.aliases() },
      );
    });
  }

  /**
   * Every card for a query (`emt similar`, `emt calibrate`), in memory: a card
   * of schema 1 is rebuilt from its journal but not written, a card newer than
   * this binary is named in `skipped`. Nothing is written.
   */
  allCards(): { readonly cards: readonly Card[]; readonly skipped: readonly string[] } {
    const cards: Card[] = [];
    const skipped: string[] = [];
    for (const stored of this.cards.list()) {
      if (stored.schema === 'newer') {
        skipped.push(stored.task);
        continue;
      }
      const card = stored.schema === 'current' ? stored.card : this.upgrade(stored.card, false);
      if (card !== undefined) {
        cards.push(card);
      }
    }
    return { cards, skipped };
  }

  /** The author's earlier ids, each to the current one. */
  aliases(): ReadonlyMap<string, string> {
    const author = this.authors.current().id;
    return new Map(this.settings.authorAliases().map((alias) => [alias, author]));
  }

  /** A card of schema 1 again from the journal of its task; by its fields when the journal is not here. */
  private upgrade(card: CardV1, write = true): Card | undefined {
    let rebuilt: Card | undefined;
    try {
      const task = this.tasks.find(TaskId.parse(card.task.id));
      rebuilt = task?.status === 'closed' ? this.build(task) : undefined;
    } catch (error) {
      this.errors.report(`rebuilding the card of ${card.task.id}`, error);
    }
    if (rebuilt !== undefined && !write) {
      return rebuilt;
    }
    if (rebuilt !== undefined) {
      try {
        this.cards.write(rebuilt);
      } catch (error) {
        // The card is right in memory; the next recalculation writes it again.
        this.errors.report(`writing the card of ${card.task.id}`, error);
      }
      return rebuilt;
    }
    try {
      return upgradeCardV1(card);
    } catch (error) {
      this.errors.report(`reading the card of ${card.task.id}`, error);
      return undefined;
    }
  }
}

/** Snapshots of the plan by project: at the start, at every checkpoint and revision, at the closing. */
function planPoints(records: readonly ProgressRecord[]): PlanPoint[] {
  const points: PlanPoint[] = [];
  for (const record of records) {
    const at = Timestamp.parse(record.ts);
    if (record.type === 'plan.started' || record.type === 'plan.closing' || record.type === 'plan.revised') {
      const revision = record.type === 'plan.revised' ? { revision: record.data.revision } : {};
      for (const project of record.data.projects) {
        if (project.changes !== undefined) {
          points.push({ at, project: project.project, changes: project.changes, ...revision });
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
      ? [{ at: Timestamp.parse(record.data.completedAt), project: record.data.project, change: record.data.change, directory: record.data.directory }]
      : [],
  );
}
