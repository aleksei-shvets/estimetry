import type { SessionId } from '../../domain/measurement/session-id.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';
import { isInProgress } from '../../domain/task/task-status.js';
import type { LocatedProject } from '../ports/project-locator.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { TaskStatusReader } from '../ports/task-status-reader.js';
import type { SessionWindow } from './session-window.js';

/**
 * `emt attach <task> --session <id>`: the session serves `task`. A switch goes
 * from now on: the previous task gets the end of the window and the new one its
 * start, so a switch in the middle of a turn neither doubles nor loses time. The
 * first task of a session is counted from its start, as an automatic binding
 * does: its events made since then come over from the journal without a task.
 */
export class BindSession {
  constructor(
    private readonly bindings: SessionBindings,
    private readonly tasks: TaskStatusReader,
    private readonly window: Pick<SessionWindow, 'open' | 'close'>,
  ) {}

  bind(session: SessionId, task: TaskId, project: LocatedProject, now: Timestamp): void {
    const summary = this.tasks.summary(task);
    if (summary === undefined || !isInProgress(summary.status)) {
      throw new InvalidValue(`${task} is not in progress; start it with \`emt start ${task}\` first`);
    }
    let previous: { id: TaskId; project: ProjectId } | undefined;
    let opened: { since: Timestamp; carryFrom?: ProjectId } | undefined;
    this.bindings.update(session, (current) => {
      if (current?.task?.equals(task) === true) {
        return undefined; // already bound: nothing to switch
      }
      if (current?.task !== undefined && this.inProgress(current.task)) {
        previous = { id: current.task, project: current.project };
      }
      // The events of a session without a task are in the journal of the project it ran in.
      const first = current?.everBound !== true && summary.startedAt !== undefined;
      opened = first ? { since: summary.startedAt, carryFrom: current?.project ?? project.id } : { since: now };
      return { session, project: project.id, root: project.root, task, since: opened.since, everBound: true };
    });
    if (previous !== undefined) {
      this.window.close(session, previous, now);
    }
    if (opened !== undefined) {
      this.window.open(session, { id: task, project: project.id }, opened.since, opened.carryFrom);
    }
  }

  private inProgress(task: TaskId): boolean {
    const summary = this.tasks.summary(task);
    return summary !== undefined && isInProgress(summary.status);
  }
}
