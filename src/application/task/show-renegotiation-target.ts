import type { TaskId } from '../../domain/task/task-id.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import { toTaskView, type TaskView } from './task-view.js';

/** The task `emt renegotiate` would close, for the confirmation. */
export class ShowRenegotiationTarget {
  constructor(private readonly activeTask: ResolveActiveTask) {}

  execute(input: { readonly task?: TaskId }): TaskView {
    const task = this.activeTask.inProgress(input.task);
    task.assertCanClose();
    return toTaskView(task);
  }
}
