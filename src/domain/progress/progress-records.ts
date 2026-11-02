import { CalendarDate } from '../shared/calendar-date.js';
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
  /** `YYYY-MM-DD` from the name of the archive directory; absent for active changes and in older checkpoints. */
  readonly archivedOn?: string;
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

/**
 * A change of the task's plan appeared in the archive. `directory` is the key:
 * a change created again and archived again is a new completion.
 */
export type ChangeCompleted = EventEnvelope<
  'change.completed',
  {
    readonly source: string;
    readonly project: string;
    readonly change: string;
    readonly directory: string;
    readonly flow: string;
    /** When the directory was moved into the archive (its ctime), or its date when that is unknown. */
    readonly completedAt: string;
    readonly detectedAt: string;
    /** True when the moment is not the move itself: a first run on a task, or a ctime older than the start. */
    readonly approximate: boolean;
  }
>;

/** Archive directories that existed before the task, noted on the first run so they never count as completions. */
export type PlanBaseline = EventEnvelope<
  'plan.baseline',
  { readonly source: string; readonly project: string; readonly directories: readonly string[] }
>;

/** The plan of one project of the task in a snapshot; a project not readable here has `unavailable` instead. */
export interface ProjectPlanSnapshot {
  readonly project: string;
  readonly changes?: readonly ChangeProgress[];
  readonly head?: string;
  readonly unavailable?: string;
}

/** The plan when work started: the base the checkboxes closed during the task are counted from. */
export type PlanStarted = EventEnvelope<
  'plan.started',
  { readonly source: string; readonly projects: readonly ProjectPlanSnapshot[] }
>;

/**
 * The plan when the task closed, with what the card needs of it: the card is
 * built from the journal alone, so it never reads `tasks.md`, the archive or
 * the project registry again.
 */
export type PlanClosing = EventEnvelope<
  'plan.closing',
  {
    readonly source: string;
    readonly projects: readonly ProjectPlanSnapshot[];
    /** Percent of the plan done; absent when it cannot be counted. */
    readonly done?: number;
    /** Groups of the estimate whose changes are all completed, and the rest. */
    readonly completedGroups: readonly string[];
    readonly unfinishedGroups: readonly string[];
    /** Stack of the task's projects, for a task without an estimate. */
    readonly stack: readonly string[];
  }
>;

export const CODE_SOURCES = ['commits', 'snapshots', 'unknown'] as const;
export type CodeSource = (typeof CODE_SOURCES)[number];

/** Code volume of one project of the task, measured before closing. */
export interface ProjectCode extends FileList {
  readonly project: string;
  readonly source: CodeSource;
  /** Why the volume is `unknown`, e.g. `base-not-ancestor`, `not-on-this-machine`. */
  readonly reason?: string;
  /** Recorded commits whose reachability could not be checked. */
  readonly unverified?: boolean;
  /** Recorded commits no longer reachable from `HEAD` (amended, rebased, another branch). */
  readonly unreachable?: number;
  /** Commits of the author between the base and `HEAD` that were not recorded; their lines are counted from git. */
  readonly uncovered?: number;
}

/** Changed files of the task by project; the card classifies them on every build, so masks can change later. */
export type CodeMeasured = EventEnvelope<
  'code.measured',
  { readonly source: string; readonly measuredAt: string; readonly projects: readonly ProjectCode[] }
>;

export type ProgressRecord =
  | CheckpointRecorded
  | CommitRecorded
  | ChangeCompleted
  | PlanBaseline
  | PlanStarted
  | PlanClosing
  | CodeMeasured;
export const PROGRESS_RECORD_TYPES: readonly ProgressRecord['type'][] = [
  'checkpoint.recorded',
  'commit.recorded',
  'change.completed',
  'plan.baseline',
  'plan.started',
  'plan.closing',
  'code.measured',
];

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
  } else if (type === 'change.completed') {
    for (const key of ['project', 'change', 'directory', 'flow']) {
      text(data, key, 'data.');
    }
    for (const key of ['completedAt', 'detectedAt']) {
      if (Number.isNaN(Date.parse(text(data, key, 'data.')))) {
        throw new InvalidProgressRecord(`data.${key}`, 'must be an ISO 8601 time');
      }
    }
    if (typeof data['approximate'] !== 'boolean') {
      throw new InvalidProgressRecord('data.approximate', 'must be true or false');
    }
  } else if (type === 'plan.started' || type === 'plan.closing') {
    list(data['projects'], 'data.projects').forEach((item, i) => projectPlan(item, `data.projects[${i}]`));
    if (type === 'plan.closing') {
      if (data['done'] !== undefined) {
        count(data, 'done', 'data.');
      }
      for (const key of ['completedGroups', 'unfinishedGroups', 'stack']) {
        strings(data[key], `data.${key}`);
      }
    }
  } else if (type === 'code.measured') {
    if (Number.isNaN(Date.parse(text(data, 'measuredAt', 'data.')))) {
      throw new InvalidProgressRecord('data.measuredAt', 'must be an ISO 8601 time');
    }
    list(data['projects'], 'data.projects').forEach((item, i) => {
      const path = `data.projects[${i}]`;
      const code = files(item, path);
      text(code, 'project', `${path}.`);
      if (!(CODE_SOURCES as readonly unknown[]).includes(code['source'])) {
        throw new InvalidProgressRecord(`${path}.source`, `must be one of ${CODE_SOURCES.join(', ')}`);
      }
      for (const key of ['unreachable', 'uncovered']) {
        if (code[key] !== undefined) {
          count(code, key, `${path}.`);
        }
      }
    });
  } else if (type === 'plan.baseline') {
    text(data, 'project', 'data.');
    list(data['directories'], 'data.directories').forEach((directory, i) => {
      if (typeof directory !== 'string') {
        throw new InvalidProgressRecord(`data.directories[${i}]`, 'must be a string');
      }
    });
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
  if (item['archivedOn'] !== undefined) {
    try {
      CalendarDate.parse(String(item['archivedOn']));
    } catch {
      throw new InvalidProgressRecord(`${path}.archivedOn`, 'must be a date YYYY-MM-DD');
    }
  }
  count(item, 'done', `${path}.`);
  count(item, 'total', `${path}.`);
}

function projectPlan(value: unknown, path: string): void {
  const item = object(value, path);
  text(item, 'project', `${path}.`);
  if (item['changes'] !== undefined) {
    list(item['changes'], `${path}.changes`).forEach((entry, i) => change(entry, `${path}.changes[${i}]`));
  }
  if (item['head'] !== undefined) {
    text(item, 'head', `${path}.`);
  }
}

function strings(value: unknown, path: string): void {
  list(value, path).forEach((item, i) => {
    if (typeof item !== 'string') {
      throw new InvalidProgressRecord(`${path}[${i}]`, 'must be a string');
    }
  });
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
