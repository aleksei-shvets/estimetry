import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import { toTaskView, type TaskView } from './task-view.js';

export class ListTasks {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
  ) {}

  /**
   * Tasks of the current project, or of all projects with `all`; closed tasks
   * only with `closed`. Never registers a project.
   */
  execute(input: { readonly all?: boolean; readonly closed?: boolean }): TaskView[] {
    const project = input.all ? undefined : this.currentProject.find();
    const tasks = input.all ? this.tasks.listAll() : project ? this.tasks.listByProject(project.id) : [];
    return tasks.filter((task) => input.closed === true || task.status !== 'closed').map(toTaskView);
  }
}
