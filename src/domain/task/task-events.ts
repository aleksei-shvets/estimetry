import type { EstimateData } from '../estimate/estimate.js';
import type { ExtraData } from '../measurement/extra.js';
import type { ManualTimeData } from '../measurement/manual-time.js';
import type { ParallelModeChangeData } from '../measurement/parallel-mode.js';
import type { EventEnvelope, EventMeta } from '../shared/event-envelope.js';
import type { TaskId } from './task-id.js';

export const TASK_EVENT_SCHEMA_VERSION = 1;

export type TaskCreated = EventEnvelope<
  'task.created',
  { readonly title: string; readonly taskType: string; readonly ticket?: string }
>;

/** `at` is the moment work started when it was recorded later; otherwise `ts`. */
export type TaskStarted = EventEnvelope<'task.started', { readonly estimated: boolean; readonly at?: string }>;

export type TaskAttached = EventEnvelope<'task.attached', Record<string, never>>;

export type TaskEstimated = EventEnvelope<'task.estimated', { readonly estimate: EstimateData; readonly taskType?: string }>;

export type TaskManualTimeRecorded = EventEnvelope<'task.manual-time-recorded', ManualTimeData>;

export type TaskExtraRecorded = EventEnvelope<'task.extra-recorded', ExtraData>;

export type TaskParallelModeEnabled = EventEnvelope<'task.parallel-mode-enabled', ParallelModeChangeData>;

export type TaskParallelModeDisabled = EventEnvelope<'task.parallel-mode-disabled', Record<string, never>>;

export type TaskEvent =
  | TaskCreated
  | TaskStarted
  | TaskAttached
  | TaskEstimated
  | TaskManualTimeRecorded
  | TaskExtraRecorded
  | TaskParallelModeEnabled
  | TaskParallelModeDisabled;

export const TASK_EVENT_TYPES: readonly TaskEvent['type'][] = [
  'task.created',
  'task.started',
  'task.attached',
  'task.estimated',
  'task.manual-time-recorded',
  'task.extra-recorded',
  'task.parallel-mode-enabled',
  'task.parallel-mode-disabled',
];

export function isTaskEventType(type: string): type is TaskEvent['type'] {
  return (TASK_EVENT_TYPES as readonly string[]).includes(type);
}

export function taskEvent<T extends TaskEvent>(
  type: T['type'],
  task: TaskId,
  project: string,
  data: T['data'],
  meta: EventMeta,
): T {
  return {
    schemaVersion: TASK_EVENT_SCHEMA_VERSION,
    id: meta.id,
    ts: meta.at.toISOString(),
    type,
    author: meta.author.id,
    task: task.toString(),
    project,
    data,
  } as T;
}
