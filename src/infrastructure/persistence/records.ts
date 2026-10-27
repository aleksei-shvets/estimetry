import type { ProjectSnapshot } from '../../domain/project/project.js';
import type { TaskSnapshot } from '../../domain/task/task.js';
import { isTaskEventType, type TaskEvent } from '../../domain/task/task-events.js';
import { isTaskStatus } from '../../domain/task/task-status.js';

/*
 * Boundary checks for data read from disk. Anything that does not match the
 * expected shape is rejected here, before it reaches the domain.
 */

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function optionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

export function parseTaskEvent(value: unknown): TaskEvent | undefined {
  if (
    !isObject(value) ||
    typeof value['schemaVersion'] !== 'number' ||
    !isString(value['id']) ||
    !isString(value['ts']) ||
    !isString(value['type']) ||
    !isString(value['author']) ||
    !isString(value['task']) ||
    !optionalString(value['project']) ||
    !isObject(value['data']) ||
    !isTaskEventType(value['type'])
  ) {
    return undefined;
  }
  const data = value['data'];
  switch (value['type']) {
    case 'task.created':
      if (!isString(data['title']) || !isString(data['taskType']) || !optionalString(data['ticket'])) {
        return undefined;
      }
      break;
    case 'task.started':
      if (typeof data['estimated'] !== 'boolean') {
        return undefined;
      }
      break;
    case 'task.attached':
      if (!isString(value['project'])) {
        return undefined;
      }
      break;
  }
  return value as unknown as TaskEvent;
}

export function parseTaskSnapshot(value: unknown): TaskSnapshot | undefined {
  if (
    !isObject(value) ||
    typeof value['schemaVersion'] !== 'number' ||
    !isString(value['id']) ||
    !isString(value['title']) ||
    !isString(value['type']) ||
    !optionalString(value['ticket']) ||
    !isTaskStatus(value['status']) ||
    typeof value['estimated'] !== 'boolean' ||
    !isStringArray(value['projects']) ||
    !isString(value['author']) ||
    !isString(value['createdAt']) ||
    !optionalString(value['startedAt']) ||
    typeof value['version'] !== 'number' ||
    !isString(value['lastEventId'])
  ) {
    return undefined;
  }
  return value as unknown as TaskSnapshot;
}

export function parseProjectSnapshot(value: unknown): ProjectSnapshot | undefined {
  if (
    !isObject(value) ||
    typeof value['schemaVersion'] !== 'number' ||
    !isString(value['id']) ||
    !isString(value['name']) ||
    !isStringArray(value['paths']) ||
    !isStringArray(value['stack']) ||
    !isString(value['author']) ||
    !isString(value['createdAt'])
  ) {
    return undefined;
  }
  return value as unknown as ProjectSnapshot;
}

export interface ConfigDocument {
  readonly schemaVersion?: number;
  readonly author?: { readonly id?: string };
  readonly taskTypes?: readonly string[];
  readonly [key: string]: unknown;
}

export function parseConfig(value: unknown): ConfigDocument {
  if (!isObject(value)) {
    return {};
  }
  const author = isObject(value['author']) && isString(value['author']['id']) ? { id: value['author']['id'] } : undefined;
  const taskTypes = isStringArray(value['taskTypes']) ? value['taskTypes'] : undefined;
  return {
    ...value,
    ...(author ? { author } : {}),
    ...(taskTypes ? { taskTypes } : {}),
  };
}
