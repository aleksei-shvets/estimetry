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
import { toTaskView, type TaskView } from './task-view.js';
import type { WorkingCopy } from '../shared/working-copy.js';

export interface CloseTaskInput extends WorkingCopy {
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
    private readonly closing: TaskClosing,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: CloseTaskInput): TaskClosedResult {
    let prepared = false;
    let imported: string[] = [];
    const task = retryOnConflict(() => {
      const task = this.activeTask.inProgress(input.task);
      const meta = this.meta.next();
      // The aggregate checks the moment before anything is written.
      task.close({ at: input.at ?? meta.at, outcome: input.abandoned ? 'abandoned' : 'completed' }, meta);
      if (!prepared) {
        imported = this.closing.prepare(task, meta.at, input);
        prepared = true;
      }
      this.tasks.save(task);
      return task;
    });
    const warnings = [...imported, ...this.closing.finish(task)];
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
    closedAt: closure?.at.toISOString() ?? '',
    fact,
    estimateHours: likely ?? null,
    estimateShare: likely === undefined || fact === 0 ? null : fact / 60 / likely,
    warnings,
  };
}
