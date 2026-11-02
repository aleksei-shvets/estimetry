import type { Card } from '../../domain/card/card.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { TaskCards } from './task-cards.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface TaskDetails extends TaskView {
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
    if (task.status !== 'closed') {
      return toTaskView(task);
    }
    const card = this.cards.cardOf(task);
    return { ...toTaskView(task), card };
  }
}
