import { ACTIVITY_EVENT_SCHEMA_VERSION } from '../../domain/measurement/activity-events.js';
import type { Author } from '../../domain/shared/author.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';

/** The source of the records estimetry writes itself, not translated from a tool. */
export const CORE_SOURCE = 'estimetry';

export interface EntryMeta {
  readonly id: string;
  readonly at: Timestamp;
  readonly author: Author;
  readonly project: string;
  /** Absent in the journal of sessions without a task. */
  readonly task?: string;
}

/** Wraps data into the envelope of the journal; validation happens when the journal appends it. */
export function journalEntry<T extends { readonly type: string }>(type: T['type'], data: Record<string, unknown>, meta: EntryMeta): T {
  return {
    schemaVersion: ACTIVITY_EVENT_SCHEMA_VERSION,
    id: meta.id,
    ts: meta.at.toISOString(),
    type,
    author: meta.author.id,
    ...(meta.task === undefined ? {} : { task: meta.task }),
    project: meta.project,
    data,
  } as unknown as T;
}
