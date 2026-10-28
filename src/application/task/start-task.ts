import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface StartTaskInput {
  /** Omitted: the only startable task of the current project. */
  readonly task?: TaskId;
  /** Backdated start, for work begun before the task was recorded. */
  readonly at?: Timestamp;
}

export class StartTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
    private readonly activeTask: ResolveActiveTask,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: StartTaskInput): TaskView {
    return retryOnConflict(() => {
      const project = this.currentProject.find();
      const task = this.activeTask.toStart(input.task);
      const where = project && task.belongsTo(project.id) ? project.id : task.homeProject;
      task.start(where, this.meta.next(), input.at);
      this.tasks.save(task);
      return toTaskView(task);
    });
  }
}
