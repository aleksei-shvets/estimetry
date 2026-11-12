import type { SessionId } from '../../domain/measurement/session-id.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';

/** Which task a session serves; `task` absent means it was looked up and there was none. */
export interface SessionBinding {
  readonly session: SessionId;
  readonly project: ProjectId;
  /** Root of the working copy, for plan and git snapshots. */
  readonly root: string;
  readonly task?: TaskId;
  /** Start of the current window. */
  readonly since?: Timestamp;
  /** When "no task" was decided; it is revisited after a minute. */
  readonly checkedAt?: Timestamp;
  /** The session has served some task before; a later automatic binding starts at the binding, not at the task start. */
  readonly everBound?: boolean;
  /**
   * The task whose closing unbound the session. Until its next session start
   * or an explicit attach, it is not bound automatically: the rest of the turn
   * belongs to the closed task, not to another one.
   */
  readonly closedTask?: TaskId;
  /** Every task the session has served, in order; absent in bindings written before it was kept. */
  readonly tasks?: readonly TaskId[];
  /** Path of the session log the tool reported in its hooks. */
  readonly transcript?: string;
}

/** Tasks in their first order, each once. */
function distinct(tasks: readonly TaskId[]): TaskId[] {
  return tasks.filter((task, i) => tasks.findIndex((other) => other.equals(task)) === i);
}

/**
 * What `update` keeps whatever the change builds: every task the session has
 * served and the path of its log. Callers build a binding anew on every switch.
 */
export function carryOver(current: SessionBinding | undefined, next: SessionBinding): SessionBinding {
  const served = [
    ...(current?.tasks ?? []),
    ...(current?.task === undefined ? [] : [current.task]),
    ...(next.tasks ?? []),
    ...(next.task === undefined ? [] : [next.task]),
  ];
  const tasks = distinct(served);
  const transcript = next.transcript ?? current?.transcript;
  return { ...next, ...(tasks.length === 0 ? {} : { tasks }), ...(transcript === undefined ? {} : { transcript }) };
}

/** Every task the session has served, as far as the binding remembers. */
export function servedTasks(binding: SessionBinding | undefined): TaskId[] {
  if (binding === undefined) {
    return [];
  }
  return distinct([
    ...(binding.tasks ?? []),
    ...(binding.task === undefined ? [] : [binding.task]),
    ...(binding.closedTask === undefined ? [] : [binding.closedTask]),
  ]);
}

export interface SessionBindings {
  get(session: SessionId): SessionBinding | undefined;
  /** Reads, decides and writes in one locked step; returning undefined leaves the binding as it was. The result keeps `carryOver`. */
  update(session: SessionId, change: (current: SessionBinding | undefined) => SessionBinding | undefined): SessionBinding | undefined;
  /** Bindings of the sessions of a project, for commits made outside any session. */
  ofProject(project: ProjectId): SessionBinding[];
}
