import { DomainError } from '../shared/domain-error.js';
import type { EventEnvelope } from '../shared/event-envelope.js';

/*
 * Records of progress written next to activity in the journal of a task:
 * checkpoints with snapshots of the plan and of git, and commits. They are not
 * events of the Task aggregate and do not count in its version.
 */

/** Long file lists are cut: the journal stays small, the counts stay exact. */
export const MAX_RECORDED_FILES = 1000;

export interface FileLines {
  readonly path: string;
  /** Null for a binary file. */
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface FileList {
  readonly files: readonly FileLines[];
  /** All files, also those beyond the cut. */
  readonly fileCount: number;
  readonly truncated: boolean;
}

export interface ChangeProgress {
  readonly change: string;
  readonly archived: boolean;
  readonly done: number;
  readonly total: number;
}

export type CheckpointRecorded = EventEnvelope<
  'checkpoint.recorded',
  {
    readonly source: string;
    readonly session: string;
    /** Absent when the plan could not be read; empty for a flow without a plan. */
    readonly plan?: readonly ChangeProgress[];
    readonly head?: string;
    readonly workingTree?: FileList & { readonly untracked: number };
  }
>;

export type CommitRecorded = EventEnvelope<
  'commit.recorded',
  FileList & {
    readonly source: string;
    readonly sha: string;
    readonly parents: readonly string[];
    /** `git patch-id --stable`: the same change after amend, rebase or cherry-pick has the same id. */
    readonly patchId?: string;
    readonly authoredAt: string;
    readonly committedAt: string;
  }
>;

export type ProgressRecord = CheckpointRecorded | CommitRecorded;
export const PROGRESS_RECORD_TYPES: readonly ProgressRecord['type'][] = ['checkpoint.recorded', 'commit.recorded'];

export function isProgressRecordType(type: unknown): type is ProgressRecord['type'] {
  return typeof type === 'string' && (PROGRESS_RECORD_TYPES as readonly string[]).includes(type);
}

/** Cuts a file list to the limit, keeping the real count. */
export function fileList(files: readonly FileLines[]): FileList {
  return {
    files: files.slice(0, MAX_RECORDED_FILES),
    fileCount: files.length,
    truncated: files.length > MAX_RECORDED_FILES,
  };
}

export class InvalidProgressRecord extends DomainError {
  readonly code = 'invalid-progress-record';

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`invalid progress record: ${path} ${reason}`);
  }
}

type Json = Record<string, unknown>;

/** @throws InvalidProgressRecord */
export function parseProgressRecord(value: unknown, options: { readonly withoutTask?: boolean } = {}): ProgressRecord {
  const record = object(value, '(record)');
  if (typeof record['schemaVersion'] !== 'number') {
    throw new InvalidProgressRecord('schemaVersion', 'must be a number');
  }
  text(record, 'id');
  const ts = text(record, 'ts');
  if (Number.isNaN(Date.parse(ts))) {
    throw new InvalidProgressRecord('ts', 'must be an ISO 8601 time');
  }
  text(record, 'author');
  if (!options.withoutTask) {
    text(record, 'task');
  }
  const type = record['type'];
  if (!isProgressRecordType(type)) {
    throw new InvalidProgressRecord('type', `must be one of ${PROGRESS_RECORD_TYPES.join(', ')}`);
  }
  const data = object(record['data'], 'data');
  text(data, 'source', 'data.');
  if (type === 'checkpoint.recorded') {
    text(data, 'session', 'data.');
    if (data['plan'] !== undefined) {
      list(data['plan'], 'data.plan').forEach((item, i) => change(item, `data.plan[${i}]`));
    }
    if (data['head'] !== undefined) {
      text(data, 'head', 'data.');
    }
    if (data['workingTree'] !== undefined) {
      const tree = files(data['workingTree'], 'data.workingTree');
      count(tree, 'untracked', 'data.workingTree.');
    }
  } else {
    text(data, 'sha', 'data.');
    list(data['parents'], 'data.parents').forEach((parent, i) => {
      if (typeof parent !== 'string') {
        throw new InvalidProgressRecord(`data.parents[${i}]`, 'must be a string');
      }
    });
    if (data['patchId'] !== undefined) {
      text(data, 'patchId', 'data.');
    }
    text(data, 'authoredAt', 'data.');
    text(data, 'committedAt', 'data.');
    files(data, 'data');
  }
  return record as unknown as ProgressRecord;
}

function change(value: unknown, path: string): void {
  const item = object(value, path);
  text(item, 'change', `${path}.`);
  if (typeof item['archived'] !== 'boolean') {
    throw new InvalidProgressRecord(`${path}.archived`, 'must be true or false');
  }
  count(item, 'done', `${path}.`);
  count(item, 'total', `${path}.`);
}

function files(value: unknown, path: string): Json {
  const group = object(value, path);
  list(group['files'], `${path}.files`).forEach((item, i) => {
    const file = object(item, `${path}.files[${i}]`);
    text(file, 'path', `${path}.files[${i}].`);
    for (const key of ['added', 'deleted']) {
      if (file[key] !== null) {
        count(file, key, `${path}.files[${i}].`);
      }
    }
  });
  count(group, 'fileCount', `${path}.`);
  if (typeof group['truncated'] !== 'boolean') {
    throw new InvalidProgressRecord(`${path}.truncated`, 'must be true or false');
  }
  return group;
}

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidProgressRecord(path, 'must be an object');
  }
  return value as Json;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new InvalidProgressRecord(path, 'must be a list');
  }
  return value;
}

function text(record: Json, key: string, prefix = ''): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new InvalidProgressRecord(`${prefix}${key}`, 'must be a non-empty string');
  }
  return value;
}

function count(record: Json, key: string, prefix: string): void {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InvalidProgressRecord(`${prefix}${key}`, 'must be a non-negative integer');
  }
}
