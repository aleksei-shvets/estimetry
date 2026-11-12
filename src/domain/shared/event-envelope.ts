import type { Author } from './author.js';
import type { Timestamp } from './timestamp.js';

/**
 * Envelope shared by every journal record. Domain events are stored as-is, so
 * this is both the in-memory shape and the JSONL line format.
 */
export interface EventEnvelope<TType extends string = string, TData = unknown> {
  readonly schemaVersion: number;
  readonly id: string;
  readonly ts: string;
  readonly type: TType;
  readonly author: string;
  readonly task: string;
  readonly project?: string;
  readonly data: TData;
}

/** A record of the journal of sessions without a task: the envelope has no `task`. */
export type WithoutTask<T> = T extends unknown ? Omit<T, 'task'> : never;

/** Who and when, supplied by the application layer for every new event. */
export interface EventMeta {
  readonly id: string;
  readonly at: Timestamp;
  readonly author: Author;
}
