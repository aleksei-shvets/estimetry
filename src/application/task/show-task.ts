import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import { toTaskView, type TaskView } from './task-view.js';

export class ShowTask {
  constructor(private readonly tasks: TaskRepository) {}

  execute(input: { readonly task: TaskId }): TaskView {
    return toTaskView(this.tasks.get(input.task));
  }
}
