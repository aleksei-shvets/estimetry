import { buildCard, type Card } from '../../domain/card/card.js';
import { revisionFacts } from '../../domain/card/revision-facts.js';
import { IntervalSet } from '../../domain/measurement/interval-set.js';
import { partFacts, type CompletionPoint, type PlanPoint } from '../../domain/progress/part-facts.js';
import type { ProgressRecord } from '../../domain/progress/progress-records.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskUsage } from '../../domain/usage/task-usage.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { TaskMeasurement } from './task-measurement.js';

/** The card of a closed task from its journal alone: `emt rebuild` gets the same card. */
export class CardBuilder {
  constructor(
    private readonly journal: Pick<EventJournal, 'readAll'>,
    private readonly measurement: TaskMeasurement,
    private readonly tasks: Pick<TaskRepository, 'find'>,
  ) {}

  build(task: Task): Card {
    const content = this.journal.readAll(task.id);
    const { activity, records } = content;
    const report = this.measurement.measure(task, content);
    const counted = this.measurement.counted(task, content);
    const last = task.revisions.at(-1);
    return buildCard({
      task,
      report,
      counted,
      partFacts: partFacts({
        estimate: task.estimate,
        startedAt: task.requireStartedAt(),
        closedAt: task.requireClosedAt(),
        points: planPoints(records),
        completions: completions(records),
        measured: counted.measured,
        manual: task.manualTime,
        manualRecordedAt: task.manualRecords.map((record) => record.recordedAt),
        lost: IntervalSet.of(task.lostWindows.map((window) => window.interval())),
        ...(last === undefined ? {} : { revision: { id: last.id, at: last.at, exclusions: task.planExclusions } }),
      }),
      revisionFacts: revisionFacts(task.revisions, {
        report,
        countedAt: (at) => this.measurement.countedAt(task, at, content),
        without: (window) => this.measurement.without(task, window, content),
      }),
      records,
      hasActivity: activity.length > 0,
      ...usageOf(this.measurement.usage(task, content)),
    });
  }

  /** The card of a task by its id when the task is here and closed; undefined otherwise. */
  rebuild(id: TaskId): Card | undefined {
    const task = this.tasks.find(id);
    return task?.isClosed === true ? this.build(task) : undefined;
  }
}

function usageOf(usage: TaskUsage | undefined): { usage?: TaskUsage } {
  return usage === undefined ? {} : { usage };
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
