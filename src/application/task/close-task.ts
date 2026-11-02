import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskOutcome } from '../../domain/task/task-events.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskClosing } from './task-closing.js';
import type { TaskMeasurement } from './task-measurement.js';
import type { PlanSnapshots } from './plan-snapshots.js';
import { toTaskView, type TaskView } from './task-view.js';

/** What the user confirms: shown before anything is written. */
export interface CloseSummary {
  readonly task: TaskView;
  /** Whole minutes so far. */
  readonly fact: number;
  readonly estimateHours: number | null;
  readonly estimateShare: number | null;
  readonly planDone: number | null;
  readonly unfinishedGroups: readonly string[];
}

export interface CloseTaskInput {
  readonly task?: TaskId;
  readonly at?: Timestamp;
  readonly abandoned?: boolean;
}

export interface TaskClosedResult {
  readonly task: TaskView;
  readonly outcome: TaskOutcome;
  readonly closedAt: string;
  readonly fact: number;
  readonly estimateHours: number | null;
  readonly estimateShare: number | null;
  /** Derived steps that failed; `emt rebuild` repeats them. */
  readonly warnings: readonly string[];
}

/**
 * `emt close`: the interface asks the user first and calls `execute` only
 * with their consent (design §2: a task never closes by itself).
 */
export class CloseTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activeTask: ResolveActiveTask,
    private readonly measurement: TaskMeasurement,
    private readonly plans: PlanSnapshots,
    private readonly closing: TaskClosing,
    private readonly meta: EventMetaSource,
    private readonly near: string | undefined,
  ) {}

  summary(input: { readonly task?: TaskId }): CloseSummary {
    const task = this.activeTask.inProgress(input.task);
    task.assertCanClose();
    const fact = Math.round(this.measurement.counted(task).fact.minutes);
    const likely = task.estimate?.total.likely;
    const plan = this.plans.closing(task, this.near);
    return {
      task: toTaskView(task),
      fact,
      estimateHours: likely ?? null,
      estimateShare: likely === undefined || fact === 0 ? null : fact / 60 / likely,
      planDone: plan.done ?? null,
      unfinishedGroups: plan.unfinishedGroups,
    };
  }

  execute(input: CloseTaskInput): TaskClosedResult {
    let prepared = false;
    const task = retryOnConflict(() => {
      const task = this.activeTask.inProgress(input.task);
      const meta = this.meta.next();
      // The aggregate checks the moment before anything is written.
      task.close({ at: input.at ?? meta.at, outcome: input.abandoned ? 'abandoned' : 'completed' }, meta);
      if (!prepared) {
        this.closing.prepare(task, this.near);
        prepared = true;
      }
      this.tasks.save(task);
      return task;
    });
    const warnings = this.closing.finish(task);
    return closedResult(task, this.measurement, warnings);
  }
}

export function closedResult(
  task: Task,
  measurement: TaskMeasurement,
  warnings: readonly string[],
): TaskClosedResult {
  const fact = Math.round(measurement.counted(task).fact.minutes);
  const likely = task.estimate?.total.likely;
  const closure = task.closure;
  return {
    task: toTaskView(task),
    outcome: closure?.outcome ?? 'completed',
    closedAt: closure?.at ?? '',
    fact,
    estimateHours: likely ?? null,
    estimateShare: likely === undefined || fact === 0 ? null : fact / 60 / likely,
    warnings,
  };
}
