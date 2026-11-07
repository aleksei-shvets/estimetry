import type { EstimateData } from '../../domain/estimate/estimate.js';
import type { Card } from '../../domain/card/card.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { TaskCards } from './task-cards.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface TaskDetails extends TaskView {
  /** The estimate in force, in the format of an estimate file: a base for `emt estimate revise`. */
  readonly estimate?: EstimateData;
  /** The card of a closed task; built from the journal when the file is missing or older. */
  readonly card?: Card;
}

export class ShowTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly cards: Pick<TaskCards, 'cardOf'>,
  ) {}

  execute(input: { readonly task: TaskId }): TaskDetails {
    const task = this.tasks.get(input.task);
    const estimate = task.estimate === undefined ? {} : { estimate: task.estimate.toData() };
    if (task.status !== 'closed') {
      return { ...toTaskView(task), ...estimate };
    }
    const card = this.cards.cardOf(task);
    return { ...toTaskView(task), ...estimate, card };
  }
}
