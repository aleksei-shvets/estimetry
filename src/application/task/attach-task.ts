import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface AttachTaskResult {
  readonly task: TaskView;
  readonly project: string;
  /** False when the task was already connected to this project. */
  readonly attached: boolean;
}

export class AttachTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: { readonly task: TaskId }): AttachTaskResult {
    // Fail on an unknown task before registering the project.
    this.tasks.get(input.task);
    const project = this.currentProject.findOrRegister();
    return retryOnConflict(() => {
      const task = this.tasks.get(input.task);
      const attached = task.attach(project.id, this.meta.next());
      if (attached) {
        this.tasks.save(task);
      }
      return { task: toTaskView(task), project: project.id.value, attached };
    });
  }
}
