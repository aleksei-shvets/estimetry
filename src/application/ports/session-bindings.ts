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
}

export interface SessionBindings {
  get(session: SessionId): SessionBinding | undefined;
  /** Reads, decides and writes in one locked step; returning undefined leaves the binding as it was. */
  update(session: SessionId, change: (current: SessionBinding | undefined) => SessionBinding | undefined): SessionBinding | undefined;
  /** Bindings of the sessions of a project, for commits made outside any session. */
  ofProject(project: string): SessionBinding[];
}
