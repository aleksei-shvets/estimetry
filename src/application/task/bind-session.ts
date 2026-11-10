import type { SessionBound, SessionUnbound } from '../../domain/measurement/activity-events.js';
import { SessionId } from '../../domain/measurement/session-id.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { LocatedProject } from '../ports/project-locator.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { TaskStatusReader } from '../ports/task-status-reader.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';


/**
 * `emt attach <task> --session <id>`: the session serves `task` from now on.
 * The previous task gets the end of the window and the new one its start, so
 * a switch in the middle of a turn neither doubles nor loses time.
 */
export class BindSession {
  constructor(
    private readonly bindings: SessionBindings,
    private readonly tasks: TaskStatusReader,
    private readonly journal: EventJournal,
    private readonly ids: IdGenerator,
    private readonly authors: AuthorProvider,
  ) {}

  bind(sessionText: string, task: string, project: LocatedProject, now: Timestamp): void {
    const session = SessionId.parse(sessionText);
    if (this.tasks.summary(task)?.status !== 'in-progress') {
      throw new InvalidValue(`${task} is not in progress; start it with \`emt start ${task}\` first`);
    }
    let previous: { task: string; project: string } | undefined;
    this.bindings.update(session, (current) => {
      if (current?.task === task) {
        return undefined; // already bound: nothing to switch
      }
      if (current?.task !== undefined && this.tasks.summary(current.task)?.status === 'in-progress') {
        previous = { task: current.task, project: current.project };
      }
      return { session: session.value, project: project.id, root: project.root, task, since: now.toISOString(), everBound: true };
    });
    if (previous !== undefined) {
      this.mark<SessionUnbound>('session.unbound', session, previous.task, previous.project, now);
    }
    if (this.bindings.get(session)?.since === now.toISOString()) {
      this.mark<SessionBound>('session.bound', session, task, project.id, now);
    }
  }

  private mark<T extends SessionBound | SessionUnbound>(type: T['type'], session: SessionId, task: string, project: string, at: Timestamp): void {
    this.journal.append(
      journalEntry<T>(type, { source: CORE_SOURCE, session: session.value }, { id: this.ids.next(), at, author: this.authors.current(), project, task }),
    );
  }
}
