import { CalendarDate } from '../shared/calendar-date.js';
import { DomainError } from '../shared/domain-error.js';
import { CODE_SOURCES, isProgressRecordType, PROGRESS_RECORD_TYPES, type ProgressRecord } from './progress-records.js';

/*
 * Checks a progress record read from a journal before it reaches the domain:
 * the envelope, then the data of its type. Paths in errors name the field.
 */

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

/** Checks of the data of each type of record. */
const DATA_CHECKS: Readonly<Record<ProgressRecord['type'], (data: Json, type: ProgressRecord['type']) => void>> = {
  'checkpoint.recorded': checkpoint,
  'commit.recorded': commit,
  'change.completed': changeCompleted,
  'plan.baseline': planBaseline,
  'plan.started': plan,
  'plan.revised': plan,
  'plan.closing': plan,
  'code.measured': codeMeasured,
  'log.session': logSession,
};

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
  DATA_CHECKS[type](data, type);
  return record as unknown as ProgressRecord;
}

function checkpoint(data: Json): void {
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
}

function changeCompleted(data: Json): void {
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
}

function plan(data: Json, type: ProgressRecord['type']): void {
  list(data['projects'], 'data.projects').forEach((item, i) => projectPlan(item, `data.projects[${i}]`));
  if (type === 'plan.revised') {
    text(data, 'revision', 'data.');
  }
  if (type === 'plan.closing') {
    if (data['done'] !== undefined) {
      count(data, 'done', 'data.');
    }
    for (const key of ['completedGroups', 'unfinishedGroups', 'stack']) {
      strings(data[key], `data.${key}`);
    }
  }
}

function codeMeasured(data: Json): void {
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
}

function planBaseline(data: Json): void {
  text(data, 'project', 'data.');
  list(data['directories'], 'data.directories').forEach((directory, i) => {
    if (typeof directory !== 'string') {
      throw new InvalidProgressRecord(`data.directories[${i}]`, 'must be a string');
    }
  });
}

function commit(data: Json): void {
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

function logSession(data: Json): void {
  text(data, 'session', 'data.');
  text(data, 'importId', 'data.');
  for (const key of ['from', 'part', 'parts', 'skipped']) {
    count(data, key, 'data.');
  }
  list(data['turns'], 'data.turns').forEach((item, i) => {
    const turn = object(item, `data.turns[${i}]`);
    count(turn, 'key', `data.turns[${i}].`);
    for (const key of ['start', 'end']) {
      if (turn[key] !== undefined) {
        moment(turn, key, `data.turns[${i}].`);
      }
    }
    buckets(turn['tokens'], `data.turns[${i}].tokens`);
  });
  list(data['agents'], 'data.agents').forEach((item, i) => {
    const agent = object(item, `data.agents[${i}]`);
    text(agent, 'agent', `data.agents[${i}].`);
    list(agent['spans'], `data.agents[${i}].spans`).forEach((span, j) => {
      const path = `data.agents[${i}].spans[${j}]`;
      if (!Array.isArray(span) || span.length !== 2 || !span.every((at) => Number.isSafeInteger(at))) {
        throw new InvalidProgressRecord(path, 'must be a pair of times in milliseconds');
      }
    });
    buckets(agent['tokens'], `data.agents[${i}].tokens`);
  });
  list(data['cost'], 'data.cost').forEach((item, i) => {
    const total = object(item, `data.cost[${i}]`);
    moment(total, 'startTime', `data.cost[${i}].`);
    if (typeof total['totalUSD'] !== 'number' || !Number.isFinite(total['totalUSD']) || total['totalUSD'] < 0) {
      throw new InvalidProgressRecord(`data.cost[${i}].totalUSD`, 'must be a non-negative number');
    }
    if (typeof total['unknown'] !== 'boolean') {
      throw new InvalidProgressRecord(`data.cost[${i}].unknown`, 'must be true or false');
    }
  });
}

function buckets(value: unknown, path: string): void {
  list(value, path).forEach((item, i) => {
    const bucket = object(item, `${path}[${i}]`);
    moment(bucket, 'at', `${path}[${i}].`);
    text(bucket, 'model', `${path}[${i}].`);
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']) {
      count(bucket, key, `${path}[${i}].`);
    }
  });
}

function moment(record: Json, key: string, prefix: string): void {
  if (!Number.isSafeInteger(record[key])) {
    throw new InvalidProgressRecord(`${prefix}${key}`, 'must be a time in milliseconds');
  }
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
