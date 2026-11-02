import type { ProjectId } from '../../domain/project/project-id.js';
import type { Task } from '../../domain/task/task.js';
import { AmbiguousTask } from '../../domain/task/task-errors.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';

/** Picks the task a command works on when the user did not name one. */
export class ResolveActiveTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
  ) {}

  /** The named task, or the only task of the current project in progress. */
  inProgress(explicit: TaskId | undefined): Task {
    return explicit
      ? this.tasks.get(explicit)
      : this.only(
          (task) => task.status === 'in-progress',
          'no task in progress in this project; start one with `emt start`',
          'several tasks are in progress, pass one with --task',
        );
  }

  /** The named task, or the only task of the current project that can be started. */
  toStart(explicit: TaskId | undefined): Task {
    return explicit
      ? this.tasks.get(explicit)
      : this.only(
          (task) => task.isStartable(),
          'no task to start in this project; create one with `emt task new`',
          'several tasks can be started, pass one explicitly',
        );
  }

  /** The named task, or the only task of the current project that can still be estimated. */
  toEstimate(explicit: TaskId | undefined): Task {
    if (explicit) {
      return this.tasks.get(explicit);
    }
    // The usual reason there is nothing to estimate: work has started, and the plan changes by revision now.
    const none = (tasks: readonly Task[]) => {
      const inProgress = tasks.filter((task) => task.status === 'in-progress').map((task) => task.id.toString());
      return inProgress.length > 0
        ? `no task to estimate in this project: ${inProgress.join(', ')} is in progress; change its plan with \`emt estimate revise\``
        : 'no task to estimate in this project; create one with `emt task new`';
    };
    return this.only((task) => task.isStartable(), none, 'several tasks can be estimated, pass one with --task');
  }

  private only(matches: (task: Task) => boolean, none: string | ((tasks: readonly Task[]) => string), several: string): Task {
    const project: ProjectId | undefined = this.currentProject.find()?.id;
    const all = project ? this.tasks.listByProject(project) : [];
    const candidates = all.filter(matches);
    const [first, ...rest] = candidates;
    if (!first) {
      throw new AmbiguousTask(typeof none === 'string' ? none : none(all), []);
    }
    if (rest.length > 0) {
      throw new AmbiguousTask(several, candidates.map((task) => task.id.toString()));
    }
    return first;
  }
}
