import type { ProjectId } from '../../domain/project/project-id.js';
import type { Task } from '../../domain/task/task.js';
import { AmbiguousTask } from '../../domain/task/task-errors.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface StartTaskInput {
  /** Omitted: the only startable task of the current project. */
  readonly task?: TaskId;
}

export class StartTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: StartTaskInput): TaskView {
    return retryOnConflict(() => {
      const project = this.currentProject.find();
      const task = input.task ? this.tasks.get(input.task) : this.onlyStartable(project?.id);
      const where = project && task.belongsTo(project.id) ? project.id : task.homeProject;
      task.start(where, this.meta.next());
      this.tasks.save(task);
      return toTaskView(task);
    });
  }

  private onlyStartable(project: ProjectId | undefined): Task {
    const candidates = project ? this.tasks.listByProject(project).filter((task) => task.isStartable()) : [];
    const [only, ...others] = candidates;
    if (only && others.length === 0) {
      return only;
    }
    if (!only) {
      throw new AmbiguousTask('no task to start in this project; create one with `emt task new`', []);
    }
    throw new AmbiguousTask(
      'several tasks can be started, pass one explicitly',
      candidates.map((task) => task.id.toString()),
    );
  }
}
