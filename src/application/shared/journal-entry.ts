import { ACTIVITY_EVENT_SCHEMA_VERSION } from '../../domain/measurement/activity-events.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import type { Author } from '../../domain/shared/author.js';
import type { EventEnvelope, WithoutTask } from '../../domain/shared/event-envelope.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';

/** The source of the records estimetry writes itself, not translated from a tool. */
export const CORE_SOURCE = 'estimetry';

/** Who, when and where a record of the journal of a project is written. */
export interface ProjectEntryMeta {
  readonly id: string;
  readonly at: Timestamp;
  readonly author: Author;
  readonly project: ProjectId;
}

/** The same for the journal of a task. */
export interface EntryMeta extends ProjectEntryMeta {
  readonly task: TaskId;
}

type Envelope = EventEnvelope<string, unknown>;

/**
 * Wraps data into the envelope of the journal of a task; the compiler checks
 * the data against the record's type, the journal validates the whole when it appends it.
 */
export function journalEntry<T extends Envelope>(type: T['type'], data: T['data'], meta: EntryMeta): T {
  // The keys keep the order of the journal: the task before the project.
  const entry: Envelope = { ...head(type, meta), task: meta.task.toString(), project: meta.project.value, data };
  return entry as T;
}

/** The same for the journal of sessions without a task in a project. */
export function projectEntry<T extends Envelope>(type: T['type'], data: T['data'], meta: ProjectEntryMeta): WithoutTask<T> {
  const entry: Omit<Envelope, 'task'> = { ...head(type, meta), project: meta.project.value, data };
  return entry as WithoutTask<T>;
}

function head(type: string, meta: ProjectEntryMeta) {
  return { schemaVersion: ACTIVITY_EVENT_SCHEMA_VERSION, id: meta.id, ts: meta.at.toISOString(), type, author: meta.author.id };
}
