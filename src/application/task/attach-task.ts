import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { BindSession } from './bind-session.js';
import type { Clock } from '../ports/clock.js';
import type { WorkspaceLocator } from '../ports/workspace-locator.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import { toTaskView, type TaskView } from './task-view.js';
import type { SessionId } from '../../domain/measurement/session-id.js';

export interface AttachTaskResult {
  readonly task: TaskView;
  readonly project: string;
  /** False when the task was already connected to this project. */
  readonly attached: boolean;
}

export interface AttachTaskInput {
  readonly task: TaskId;
  /** Also bind this session of the AI tool to the task (session-binding spec). */
  readonly session?: SessionId;
}

export class AttachTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
    private readonly meta: EventMetaSource,
    private readonly sessions: BindSession,
    private readonly workspace: WorkspaceLocator,
    private readonly clock: Clock,
  ) {}

  execute(input: AttachTaskInput): AttachTaskResult {
    // Fail on an unknown task before registering the project.
    this.tasks.get(input.task);
    const project = this.currentProject.findOrRegister();
    const result = retryOnConflict(() => {
      const task = this.tasks.get(input.task);
      const attached = task.attach(project.id, this.meta.next());
      if (attached) {
        this.tasks.save(task);
      }
      return { task: toTaskView(task), project: project.id.value, attached };
    });
    if (input.session !== undefined) {
      this.sessions.bind(input.session, input.task, { id: project.id, root: this.workspace.currentRoot() }, this.clock.now());
    }
    return result;
  }
}
