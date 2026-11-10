import { Estimate, type EstimateData } from '../../domain/estimate/estimate.js';
import { isPartKind, isPartPerformer } from '../../domain/estimate/part-kind.js';
import { isExtraCategory, type ExtraData } from '../../domain/measurement/extra.js';
import { MANUAL_TIME_KINDS, type ManualTimeData } from '../../domain/measurement/manual-time.js';
import type { ParallelModeChangeData, ParallelPeriod } from '../../domain/measurement/parallel-mode.js';
import type { ProjectSnapshot } from '../../domain/project/project.js';
import type { TaskSnapshot } from '../../domain/task/task.js';
import { isSpentPolicy } from '../../domain/estimate/estimate-revision.js';
import { JournalTooNew } from '../../domain/task/task-errors.js';
import { isTaskEventType, TASK_EVENT_SCHEMA_VERSION, TASK_OUTCOMES, type TaskEvent, type TaskOutcome } from '../../domain/task/task-events.js';
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

/**
 * An event of the task aggregate, undefined for other records and broken
 * ones. An unknown `task.*` event or a newer version of one means a newer
 * estimetry wrote the journal: that throws instead of being skipped.
 */
export function parseTaskEvent(value: unknown): TaskEvent | undefined {
  if (isObject(value) && isString(value['type']) && value['type'].startsWith('task.')) {
    const task = isString(value['task']) ? value['task'] : '?';
    if (!isTaskEventType(value['type'])) {
      throw new JournalTooNew(task, `unknown event ${value['type']}`);
    }
    if (typeof value['schemaVersion'] === 'number' && value['schemaVersion'] > TASK_EVENT_SCHEMA_VERSION) {
      throw new JournalTooNew(task, `event version ${value['schemaVersion']}`);
    }
  }
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
      if (
        !isString(data['title']) ||
        !isString(data['taskType']) ||
        !optionalString(data['ticket']) ||
        !optionalString(data['spawnedFrom'])
      ) {
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
    case 'task.reopened':
      break;
    case 'task.closed':
      if (!isTime(data['at']) || !isTaskOutcome(data['outcome']) || !optionalString(data['spawned'])) {
        return undefined;
      }
      break;
    case 'task.estimate-revised':
      if (
        !isEstimateData(data['estimate']) ||
        !optionalString(data['taskType']) ||
        !isString(data['reason']) ||
        !optional(data['category'], isExtraCategory) ||
        !optional(data['spent'], isSpentPolicy) ||
        !isTime(data['at']) ||
        !optionalTime(data['lostFrom']) ||
        !isStringArray(data['covers']) ||
        !optional(data['excluded'], isExcludedList)
      ) {
        return undefined;
      }
      break;
    case 'task.retro-recorded':
      if (
        !Array.isArray(data['reasons']) ||
        data['reasons'].length === 0 ||
        !data['reasons'].every((r) => isObject(r) && isString(r['text']) && optionalString(r['part'])) ||
        !isString(data['lesson'])
      ) {
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
    !optional(value['estimate'], isEstimateData) ||
    !optional(value['manualTime'], (v) => Array.isArray(v) && v.every(isManualTimeData)) ||
    !optional(value['extras'], (v) => Array.isArray(v) && v.every(isExtraData)) ||
    !optional(value['parallelMode'], (v) => Array.isArray(v) && v.every(isParallelPeriod)) ||
    !optionalString(value['spawnedFrom']) ||
    !optional(value['closures'], (v) => Array.isArray(v) && v.every(isClosure)) ||
    !optional(value['retro'], (v) => isObject(v) && Array.isArray(v['reasons']) && isString(v['lesson']) && isTime(v['recordedAt'])) ||
    !optional(value['lastEventAt'], isTime) ||
    !optional(value['firstEstimate'], isEstimateData) ||
    !optional(value['estimatedAfterStart'], (v) => typeof v === 'boolean') ||
    !optional(value['revisions'], (v) => Array.isArray(v) && v.every(isRevision)) ||
    !optional(value['extraRecords'], (v) => Array.isArray(v) && v.every((r) => isObject(r) && isString(r['id']) && isTime(r['at']))) ||
    !optional(value['lastPartRecordAt'], isTime) ||
    !optional(value['manualRecordedAt'], (v) => Array.isArray(v) && v.every(isTime)) ||
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
    !optional(value['codeVolume'], isObject) ||
    !optional(value['calibration'], (c) => isObject(c) && typeof c['coefficient'] === 'number')
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
    isString(value['description']) &&
    optionalString(value['part'])
  );
}

function isExtraData(value: unknown): value is ExtraData {
  return (
    isObject(value) &&
    isExtraCategory(value['category']) &&
    (value['accounting'] === 'absorbed' || (value['accounting'] === 'renegotiated' && isString(value['spawned']))) &&
    optionalString(value['spawned']) &&
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

function isRevision(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value['id']) &&
    isTime(value['at']) &&
    optionalTime(value['lostFrom']) &&
    isString(value['reason']) &&
    optional(value['category'], isExtraCategory) &&
    optional(value['spent'], isSpentPolicy) &&
    optional(value['baseLikelyBefore'], isNonNegative) &&
    isNonNegative(value['baseLikelyAfter']) &&
    optional(value['typeBefore'], isString) &&
    optional(value['typeAfter'], isString) &&
    isStringArray(value['covers']) &&
    optional(value['excluded'], isExcludedList)
  );
}

function isExcludedList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (project) =>
        isObject(project) &&
        isString(project['project']) &&
        Array.isArray(project['archives']) &&
        project['archives'].every((archive) => isObject(archive) && isString(archive['change']) && isString(archive['archivedOn'])),
    )
  );
}

function isClosure(value: unknown): boolean {
  return (
    isObject(value) &&
    isTime(value['at']) &&
    isTaskOutcome(value['outcome']) &&
    optionalString(value['spawned']) &&
    optional(value['reopenedAt'], isTime) &&
    optional(value['recordedAt'], isTime)
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
  readonly author?: { readonly id?: string; readonly aliases?: unknown };
  readonly taskTypes?: readonly string[];
  readonly measurement?: { readonly idleMinutes?: unknown; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

function withStringId(section: Record<string, unknown>): { readonly id?: string; readonly aliases?: unknown } {
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

function isTaskOutcome(value: unknown): value is TaskOutcome {
  return typeof value === 'string' && (TASK_OUTCOMES as readonly string[]).includes(value);
}
