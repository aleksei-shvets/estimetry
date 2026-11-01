import { TaskId } from '../../domain/task/task-id.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskMeasurement } from '../task/task-measurement.js';
import type { TaskPlanProgress } from '../task/task-plan-progress.js';
import type { TaskFact } from './hook-context.js';
import type { TaskFacts } from './receive-hook.js';

/** The fact of a task for the status line at the start of a session: the one hook that reads the whole journal. */
export class MeasuredTaskFacts implements TaskFacts {
  constructor(
    /** A task read from its snapshot: reading the journal to check it would double the cost of the session start. */
    private readonly tasks: { find(id: TaskId): Task | undefined },
    private readonly measurement: TaskMeasurement,
    private readonly plan: TaskPlanProgress,
  ) {}

  fact(task: string, near?: string): TaskFact | undefined {
    const found = this.tasks.find(TaskId.parse(task));
    if (!found) {
      return undefined;
    }
    const report = this.measurement.measure(found);
    const likely = found.estimate?.total.likely;
    const planDone = this.plan.of(found, { completions: false, ...(near === undefined ? {} : { near }) }).plan?.done;
    return {
      minutes: report.fact.minutes,
      ...(likely === undefined ? {} : { likelyHours: likely }),
      ...(planDone === undefined ? {} : { planDone }),
    };
  }
}
