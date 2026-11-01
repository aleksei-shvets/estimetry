import { ParallelModeChange } from '../../domain/measurement/parallel-mode.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskMeasurement } from './task-measurement.js';
import type { TaskPlanProgress } from './task-plan-progress.js';
import { toTaskView, type TaskView } from './task-view.js';

export type ChangeParallelModeInput =
  | {
      readonly enabled: true;
      readonly task?: TaskId;
      readonly reason?: string;
      readonly agents?: number;
      readonly parts?: readonly string[];
    }
  | { readonly enabled: false; readonly task?: TaskId };

export interface ParallelModeChanged {
  readonly task: TaskView;
  readonly enabled: boolean;
  /** Fact over the most likely estimate when the mode was switched on; absent without an estimate. */
  readonly budgetShare?: number;
  /** Share of the plan done when the mode was switched on; absent when the plan cannot be counted. */
  readonly planShare?: number;
}

export class ChangeParallelMode {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activeTask: ResolveActiveTask,
    private readonly measurement: TaskMeasurement,
    private readonly meta: EventMetaSource,
    private readonly plan: TaskPlanProgress,
  ) {}

  execute(input: ChangeParallelModeInput): ParallelModeChanged {
    return retryOnConflict(() => {
      const task = this.activeTask.inProgress(input.task);
      if (!input.enabled) {
        task.disableParallelMode(this.meta.next());
        this.tasks.save(task);
        return { task: toTaskView(task), enabled: false };
      }
      const likely = task.estimate?.total.likely;
      const budgetShare =
        likely === undefined ? undefined : Math.round((this.measurement.measure(task).fact.hours / likely) * 1000) / 1000;
      const done = this.plan.of(task, { completions: false }).plan?.done;
      const planShare = done === undefined ? undefined : done / 100;
      task.enableParallelMode(
        ParallelModeChange.of({
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.agents === undefined ? {} : { agents: input.agents }),
          ...(input.parts === undefined ? {} : { parts: input.parts }),
          ...(budgetShare === undefined ? {} : { budgetShare }),
          ...(planShare === undefined ? {} : { planShare }),
        }),
        this.meta.next(),
      );
      this.tasks.save(task);
      return {
        task: toTaskView(task),
        enabled: true,
        ...(budgetShare === undefined ? {} : { budgetShare }),
        ...(planShare === undefined ? {} : { planShare }),
      };
    });
  }
}
