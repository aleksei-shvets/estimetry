import type { SessionId } from '../../domain/measurement/session-id.js';
import type { ActivityEvent, SessionBound } from '../../domain/measurement/activity-events.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import { TaskId } from '../../domain/task/task-id.js';
import type { HookKind } from '../contracts/hook-adapter.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { LocatedProject } from '../ports/project-locator.js';
import type { SessionBinding, SessionBindings } from '../ports/session-bindings.js';
import type { TaskStatusReader, TaskSummary } from '../ports/task-status-reader.js';
import { journalEntry } from './journal-entry.js';

/** Records the core writes itself carry this source, not the adapter's. */
export const CORE_SOURCE = 'estimetry';

/** "No task" is looked at again after this long, so a task started mid-turn is picked up soon. */
export const RECHECK_MS = 60_000;

export interface SessionTaskResult {
  readonly project: LocatedProject;
  readonly task?: TaskSummary;
  /** Tasks in progress when the session has none: the agent is asked to choose among several. */
  readonly candidates: readonly TaskSummary[];
}

/**
 * Which task a session serves (session-binding spec). A binding changes only
 * under the lock of its file; binding writes the start of the window into the
 * task's journal and copies the session's events made without a task since the task started.
 */
export class SessionTask {
  constructor(
    private readonly bindings: SessionBindings,
    private readonly tasks: TaskStatusReader,
    private readonly journal: EventJournal,
    private readonly ids: IdGenerator,
    private readonly authors: AuthorProvider,
  ) {}

  resolve(session: SessionId, located: LocatedProject | undefined, kind: HookKind, now: Timestamp): SessionTaskResult | undefined {
    const current = this.bindings.get(session);
    const project = current ? { id: current.project, root: current.root } : located;
    if (project === undefined) {
      return undefined;
    }
    const bound = current?.task === undefined ? undefined : this.inProgress(current.task);
    if (bound) {
      return { project, task: bound, candidates: [] };
    }
    // A session unbound by closing its task stays without one until it starts again or is attached explicitly.
    if (current?.task === undefined && current?.closedTask !== undefined && kind !== 'session-start') {
      return { project, candidates: [] };
    }
    const fresh = current?.checkedAt !== undefined && now.toMillis() - Timestamp.parse(current.checkedAt).toMillis() < RECHECK_MS;
    if (current?.task === undefined && fresh && kind !== 'session-start' && kind !== 'prompt') {
      return { project, candidates: [] };
    }

    let bindsNow: { binding: SessionBinding; task: TaskSummary } | undefined;
    let candidates: TaskSummary[] = [];
    const result = this.bindings.update(session, (latest) => {
      const meanwhile = latest?.task === undefined ? undefined : this.inProgress(latest.task);
      if (meanwhile) {
        return undefined; // another process bound the session while we looked
      }
      candidates = this.tasks.inProgress(project.id);
      const [only, ...others] = candidates;
      if (only && others.length === 0) {
        // The first window starts with the task, so work done before a backdated start counts too.
        const since = latest?.everBound || only.startedAt === undefined ? now.toISOString() : only.startedAt;
        const binding: SessionBinding = { session: session.value, project: project.id, root: project.root, task: only.id, since, everBound: true };
        bindsNow = { binding, task: only };
        return binding;
      }
      return {
        session: session.value,
        project: project.id,
        root: project.root,
        checkedAt: now.toISOString(),
        ...(latest?.everBound ? { everBound: true } : {}),
      };
    });

    if (bindsNow) {
      this.openWindow(session, bindsNow.binding, bindsNow.task, now);
      return { project, task: bindsNow.task, candidates: [] };
    }
    const task = result?.task === undefined ? undefined : this.inProgress(result.task);
    return task ? { project, task, candidates: [] } : { project, candidates: candidates.length > 1 ? candidates : [] };
  }

  /** `session.bound` at the start of the window, then the session's events made without a task since then. */
  private openWindow(session: SessionId, binding: SessionBinding, task: TaskSummary, now: Timestamp): void {
    const since = Timestamp.parse(binding.since ?? now.toISOString());
    this.journal.append(
      journalEntry<SessionBound>('session.bound', { source: CORE_SOURCE, session: session.value }, {
        id: this.ids.next(),
        at: since,
        author: this.authors.current(),
        project: binding.project,
        task: task.id,
      }),
    );
    const known = new Set(this.journal.readActivity(TaskId.parse(task.id)).map((event) => event.id));
    for (const event of this.journal.readUnassigned(binding.project)) {
      if (event.data.session === session.value && Timestamp.parse(event.ts).toMillis() >= since.toMillis() && !known.has(event.id)) {
        this.journal.append({ ...event, task: task.id } as ActivityEvent);
      }
    }
  }

  private inProgress(task: string): TaskSummary | undefined {
    const summary = this.tasks.summary(task);
    return summary?.status === 'in-progress' ? summary : undefined;
  }
}
