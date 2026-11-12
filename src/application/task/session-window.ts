import type { ActivityEvent, SessionBound, SessionUnbound } from '../../domain/measurement/activity-events.js';
import type { SessionId } from '../../domain/measurement/session-id.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';

/** Where a window of a session goes: the task and its project for the envelope. */
export interface WindowTask {
  readonly id: TaskId;
  readonly project: ProjectId;
}

/**
 * Windows of a session in the journal of a task (session-binding spec): the
 * hooks and `emt attach --session` open and close them here, the same way.
 */
export class SessionWindow {
  constructor(
    private readonly journal: Pick<EventJournal, 'append' | 'readActivity' | 'readUnassigned'>,
    private readonly meta: EventMetaSource,
  ) {}

  /**
   * `session.bound` at `since`. For the first task of a session, `carryFrom`
   * names the project whose journal without a task holds its events: those
   * made since `since` are copied, each once.
   */
  open(session: SessionId, task: WindowTask, since: Timestamp, carryFrom?: ProjectId): void {
    this.mark<SessionBound>('session.bound', session, task, since);
    if (carryFrom === undefined) {
      return;
    }
    const known = new Set(this.journal.readActivity(task.id).map((event) => event.id));
    for (const event of this.journal.readUnassigned(carryFrom)) {
      const madeSince = Timestamp.parse(event.ts).toMillis() >= since.toMillis();
      if (event.data.session === session.value && madeSince && !known.has(event.id)) {
        this.journal.append({ ...event, task: task.id.toString() } as ActivityEvent);
      }
    }
  }

  /** `session.unbound` at `at`: the session stopped serving the task. */
  close(session: SessionId, task: WindowTask, at: Timestamp): void {
    this.mark<SessionUnbound>('session.unbound', session, task, at);
  }

  private mark<T extends SessionBound | SessionUnbound>(type: T['type'], session: SessionId, task: WindowTask, at: Timestamp): void {
    const data = { source: CORE_SOURCE, session: session.value };
    this.journal.append(journalEntry<T>(type, data, { ...this.meta.at(at), project: task.project, task: task.id }));
  }
}
