import type { ActivityEvent } from '../../domain/measurement/activity-events.js';
import type { SessionId } from '../../domain/measurement/session-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { HookTranslation } from '../contracts/hook-adapter.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { journalEntry } from '../shared/journal-entry.js';
import type { ChangeCompletions } from './change-completions.js';
import type { Checkpoints } from './checkpoints.js';
import type { SessionTaskResult } from './session-task.js';

/**
 * What every call of a session's hook leaves behind, whatever its kind: the
 * activity events in the journal of the task (or of the project when there is
 * none), the path of the session's log, the checkpoint and a completed change.
 */
export class ActivityRecorder {
  constructor(
    private readonly journal: EventJournal,
    private readonly bindings: SessionBindings,
    private readonly checkpoints: Pick<Checkpoints, 'touch'>,
    private readonly completions: Pick<ChangeCompletions, 'check'>,
    private readonly meta: EventMetaSource,
  ) {}

  record(source: string, translation: HookTranslation, resolved: SessionTaskResult, now: Timestamp): void {
    const { session, kind } = translation;
    this.write(source, translation, now, resolved.project.id, resolved.task?.id);
    if (translation.transcript !== undefined && (kind === 'session-start' || kind === 'session-end')) {
      this.keepTranscript(session, translation.transcript);
    }
    this.checkpoints.touch(session, kind, now, resolved.task === undefined ? undefined : { id: resolved.task.id, project: resolved.project });
    if (resolved.task !== undefined) {
      this.completions.check(resolved.task, now, resolved.project.root, session.value);
    }
  }

  /** The path of the session's log, for imports outside the tool's environment. */
  private keepTranscript(session: SessionId, transcript: string): void {
    this.bindings.update(session, (current) => (current === undefined || current.transcript === transcript ? undefined : { ...current, transcript }));
  }

  private write(source: string, translation: HookTranslation, now: Timestamp, project: string, task: string | undefined): void {
    for (const draft of translation.events) {
      const data = { ...draft.data, source, session: translation.session.value };
      const entry = journalEntry<ActivityEvent>(draft.type, data, { ...this.meta.at(now), project, ...(task === undefined ? {} : { task }) });
      if (task === undefined) {
        this.journal.appendUnassigned(project, entry);
      } else {
        this.journal.append(entry);
      }
    }
  }
}
