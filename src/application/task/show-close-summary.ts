import type { TaskId } from '../../domain/task/task-id.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import type { PlanSnapshots } from './plan-snapshots.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskMeasurement } from './task-measurement.js';
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

export interface CloseSummaryInput extends WorkingCopy {
  readonly task?: TaskId;
}

/** The fact, the share of the estimate and the plan, before `emt close` asks for consent (design §2). */
export class ShowCloseSummary {
  constructor(
    private readonly activeTask: ResolveActiveTask,
    private readonly measurement: TaskMeasurement,
    private readonly plans: PlanSnapshots,
  ) {}

  execute(input: CloseSummaryInput): CloseSummary {
    const task = this.activeTask.inProgress(input.task);
    task.assertCanClose();
    const fact = Math.round(this.measurement.counted(task).fact.minutes);
    const likely = task.estimate?.total.likely;
    const plan = this.plans.closing(task, input);
    return {
      task: toTaskView(task),
      fact,
      estimateHours: likely ?? null,
      estimateShare: likely === undefined || fact === 0 ? null : fact / 60 / likely,
      planDone: plan.done ?? null,
      unfinishedGroups: plan.unfinishedGroups,
    };
  }
}
