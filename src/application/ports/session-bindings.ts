import type { SessionId } from '../../domain/measurement/session-id.js';

/** Which task a session serves; `task` absent means it was looked up and there was none. */
export interface SessionBinding {
  readonly session: string;
  readonly project: string;
  /** Root of the working copy, for plan and git snapshots. */
  readonly root: string;
  readonly task?: string;
  /** Start of the current window. */
  readonly since?: string;
  /** When "no task" was decided; it is revisited after a minute. */
  readonly checkedAt?: string;
  /** The session has served some task before; a later automatic binding starts at the binding, not at the task start. */
  readonly everBound?: boolean;
  /**
   * The task whose closing unbound the session. Until its next session start
   * or an explicit attach, it is not bound automatically: the rest of the turn
   * belongs to the closed task, not to another one.
   */
  readonly closedTask?: string;
  /** Every task the session has served, in order; absent in bindings written before it was kept. */
  readonly tasks?: readonly string[];
  /** Path of the session log the tool reported in its hooks. */
  readonly transcript?: string;
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
  const tasks = [...new Set(served)];
  const transcript = next.transcript ?? current?.transcript;
  return { ...next, ...(tasks.length === 0 ? {} : { tasks }), ...(transcript === undefined ? {} : { transcript }) };
}

/** Every task the session has served, as far as the binding remembers. */
export function servedTasks(binding: SessionBinding | undefined): string[] {
  if (binding === undefined) {
    return [];
  }
  return [...new Set([...(binding.tasks ?? []), ...(binding.task === undefined ? [] : [binding.task]), ...(binding.closedTask === undefined ? [] : [binding.closedTask])])];
}

export interface SessionBindings {
  get(session: SessionId): SessionBinding | undefined;
  /** Reads, decides and writes in one locked step; returning undefined leaves the binding as it was. The result keeps `carryOver`. */
  update(session: SessionId, change: (current: SessionBinding | undefined) => SessionBinding | undefined): SessionBinding | undefined;
  /** Bindings of the sessions of a project, for commits made outside any session. */
  ofProject(project: string): SessionBinding[];
}
