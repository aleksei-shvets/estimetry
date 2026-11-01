import { Estimate, type EstimateData } from '../../domain/estimate/estimate.js';
import { isPartKind, isPartPerformer } from '../../domain/estimate/part-kind.js';
import { isExtraCategory, type ExtraData } from '../../domain/measurement/extra.js';
import { MANUAL_TIME_KINDS, type ManualTimeData } from '../../domain/measurement/manual-time.js';
import type { ParallelModeChangeData, ParallelPeriod } from '../../domain/measurement/parallel-mode.js';
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

function isTime(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value));
}

function optionalTime(value: unknown): boolean {
  return value === undefined || isTime(value);
}

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
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
      if (typeof data['estimated'] !== 'boolean' || !optionalTime(data['at'])) {
        return undefined;
      }
      break;
    case 'task.attached':
      if (!isString(value['project'])) {
        return undefined;
      }
      break;
    case 'task.estimated':
      if (!isEstimateData(data['estimate']) || !optionalString(data['taskType'])) {
        return undefined;
      }
      break;
    case 'task.manual-time-recorded':
      if (!isManualTimeData(data)) {
        return undefined;
      }
      break;
    case 'task.extra-recorded':
      if (!isExtraData(data)) {
        return undefined;
      }
      break;
    case 'task.parallel-mode-enabled':
      if (!isParallelModeChangeData(data)) {
        return undefined;
      }
      break;
    case 'task.parallel-mode-disabled':
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
    !optional(value['estimate'], isEstimateData) ||
    !optional(value['manualTime'], (v) => Array.isArray(v) && v.every(isManualTimeData)) ||
    !optional(value['extras'], (v) => Array.isArray(v) && v.every(isExtraData)) ||
    !optional(value['parallelMode'], (v) => Array.isArray(v) && v.every(isParallelPeriod)) ||
    typeof value['version'] !== 'number' ||
    !isString(value['lastEventId'])
  ) {
    return undefined;
  }
  // Snapshots written before records existed have none.
  return {
    ...value,
    manualTime: value['manualTime'] ?? [],
    extras: value['extras'] ?? [],
    parallelMode: value['parallelMode'] ?? [],
  } as unknown as TaskSnapshot;
}

/** Shape check plus the invariants of the estimate itself, which the domain factories enforce. */
function isEstimateData(value: unknown): value is EstimateData {
  if (
    !isObject(value) ||
    typeof value['schemaVersion'] !== 'number' ||
    typeof value['calibrated'] !== 'boolean' ||
    !Array.isArray(value['parts']) ||
    !value['parts'].every(isPartData) ||
    !optionalString(value['type']) ||
    !optional(value['stack'], isStringArray) ||
    !optional(value['basedOn'], isStringArray) ||
    !optionalString(value['rationale']) ||
    !optional(value['codeVolume'], isObject)
  ) {
    return false;
  }
  try {
    Estimate.fromData(value as unknown as EstimateData);
    return true;
  } catch {
    return false;
  }
}

function isPartData(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value['id']) &&
    isString(value['name']) &&
    optionalString(value['group']) &&
    isPartKind(value['kind']) &&
    optional(value['who'], isPartPerformer) &&
    isObject(value['hours']) &&
    ['optimistic', 'likely', 'pessimistic'].every((key) => isNonNegative((value['hours'] as Json)[key]))
  );
}

function isManualTimeData(value: unknown): value is ManualTimeData {
  return (
    isObject(value) &&
    (MANUAL_TIME_KINDS as readonly unknown[]).includes(value['kind']) &&
    isNonNegative(value['durationMs']) &&
    (value['durationMs'] as number) > 0 &&
    optionalTime(value['at']) &&
    isString(value['description'])
  );
}

function isExtraData(value: unknown): value is ExtraData {
  return (
    isObject(value) &&
    isExtraCategory(value['category']) &&
    value['accounting'] === 'absorbed' &&
    isString(value['description']) &&
    optional(value['timeMs'], isNonNegative) &&
    optional(value['lines'], isNonNegative) &&
    optionalString(value['change'])
  );
}

function isParallelModeChangeData(value: unknown): value is ParallelModeChangeData {
  return (
    isObject(value) &&
    isStringArray(value['parts']) &&
    optionalString(value['reason']) &&
    optional(value['agents'], (n) => Number.isSafeInteger(n) && (n as number) >= 1) &&
    optional(value['budgetShare'], isNonNegative) &&
    optional(value['planShare'], (share) => isNonNegative(share) && (share as number) <= 1)
  );
}

function isParallelPeriod(value: unknown): value is ParallelPeriod {
  return (
    isObject(value) &&
    isTime(value['enabledAt']) &&
    optionalTime(value['disabledAt']) &&
    isParallelModeChangeData(value['change'])
  );
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
    !isString(value['createdAt']) ||
    !(value['fingerprint'] === undefined || isString(value['fingerprint']))
  ) {
    return undefined;
  }
  return value as unknown as ProjectSnapshot;
}

export interface ConfigDocument {
  readonly schemaVersion?: number;
  readonly author?: { readonly id?: string };
  readonly taskTypes?: readonly string[];
  readonly measurement?: { readonly idleMinutes?: unknown; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

function withStringId(section: Record<string, unknown>): { readonly id?: string } {
  const { id, ...rest } = section;
  return { ...rest, ...(isString(id) ? { id } : {}) };
}

export function parseConfig(value: unknown): ConfigDocument {
  if (!isObject(value)) {
    return {};
  }
  // Known sections are narrowed to what is read; keys this version does not know are kept, so a rewrite does not lose them.
  const author = isObject(value['author']) ? withStringId(value['author']) : undefined;
  const taskTypes = isStringArray(value['taskTypes']) ? value['taskTypes'] : undefined;
  const measurement = isObject(value['measurement']) ? value['measurement'] : undefined;
  return {
    ...value,
    ...(author ? { author } : {}),
    ...(taskTypes ? { taskTypes } : {}),
    ...(measurement ? { measurement } : {}),
  };
}
