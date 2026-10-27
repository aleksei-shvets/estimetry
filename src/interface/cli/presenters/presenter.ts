import type { AttachTaskResult } from '../../../application/task/attach-task.js';
import type { TaskView } from '../../../application/task/task-view.js';

/** Renders use case results; `--json` picks the JSON presenter instead of branching in commands. */
export interface Presenter {
  taskCreated(task: TaskView): string;
  taskList(tasks: readonly TaskView[], options: { readonly all: boolean }): string;
  taskDetails(task: TaskView): string;
  taskStarted(task: TaskView): string;
  taskAttached(result: AttachTaskResult): string;
}
