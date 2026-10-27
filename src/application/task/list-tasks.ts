import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import { toTaskView, type TaskView } from './task-view.js';

export class ListTasks {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
  ) {}

  /** Tasks of the current project, or of all projects with `all`. Never registers a project. */
  execute(input: { readonly all?: boolean }): TaskView[] {
    if (input.all) {
      return this.tasks.listAll().map(toTaskView);
    }
    const project = this.currentProject.find();
    return project ? this.tasks.listByProject(project.id).map(toTaskView) : [];
  }
}
