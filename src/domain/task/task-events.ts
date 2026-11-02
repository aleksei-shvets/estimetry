import type { EstimateData } from '../estimate/estimate.js';
import type { ExcludedArchives, SpentPolicy } from '../estimate/estimate-revision.js';
import type { ExtraCategory, ExtraData } from '../measurement/extra.js';
import type { ManualTimeData } from '../measurement/manual-time.js';
import type { ParallelModeChangeData } from '../measurement/parallel-mode.js';
import type { EventEnvelope, EventMeta } from '../shared/event-envelope.js';
import type { TaskId } from './task-id.js';

export const TASK_EVENT_SCHEMA_VERSION = 1;

export type TaskCreated = EventEnvelope<
  'task.created',
  {
    readonly title: string;
    readonly taskType: string;
    readonly ticket?: string;
    /** The task this one was spawned from by renegotiation. */
    readonly spawnedFrom?: string;
  }
>;

/** `at` is the moment work started when it was recorded later; otherwise `ts`. */
export type TaskStarted = EventEnvelope<'task.started', { readonly estimated: boolean; readonly at?: string }>;

export type TaskAttached = EventEnvelope<'task.attached', Record<string, never>>;

export type TaskEstimated = EventEnvelope<'task.estimated', { readonly estimate: EstimateData; readonly taskType?: string }>;

export type TaskManualTimeRecorded = EventEnvelope<'task.manual-time-recorded', ManualTimeData>;

export type TaskExtraRecorded = EventEnvelope<'task.extra-recorded', ExtraData>;

export type TaskParallelModeEnabled = EventEnvelope<'task.parallel-mode-enabled', ParallelModeChangeData>;

export type TaskParallelModeDisabled = EventEnvelope<'task.parallel-mode-disabled', Record<string, never>>;

export const TASK_OUTCOMES = ['completed', 'renegotiated', 'abandoned'] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

/** `at` is the moment work ended; parallel mode, if on, ends there too. */
export type TaskClosed = EventEnvelope<
  'task.closed',
  { readonly at: string; readonly outcome: TaskOutcome; readonly spawned?: string }
>;

export type TaskReopened = EventEnvelope<'task.reopened', Record<string, never>>;

export interface RetroReason {
  readonly text: string;
  /** Id of the estimate part the reason is about. */
  readonly part?: string;
}

export type TaskRetroRecorded = EventEnvelope<
  'task.retro-recorded',
  { readonly reasons: readonly RetroReason[]; readonly lesson: string }
>;

/** A new estimate of a task in progress (estimate-revision spec). */
export type TaskEstimateRevised = EventEnvelope<
  'task.estimate-revised',
  {
    readonly estimate: EstimateData;
    readonly taskType?: string;
    readonly reason: string;
    /** Absent when a task that started without an estimate gets its first one. */
    readonly category?: ExtraCategory;
    readonly spent?: SpentPolicy;
    /** From when the new estimate holds. */
    readonly at: string;
    /** With `exclude`: the work in `[lostFrom, at]` was thrown away. */
    readonly lostFrom?: string;
    /** Ids of extra work the user confirmed describes the same loss. */
    readonly covers: readonly string[];
    /** With `exclude`: archived changes rolled back, by project; a project not listed was not readable then. */
    readonly excluded?: readonly ExcludedArchives[];
  }
>;

export type TaskEvent =
  | TaskCreated
  | TaskStarted
  | TaskAttached
  | TaskEstimated
  | TaskManualTimeRecorded
  | TaskExtraRecorded
  | TaskParallelModeEnabled
  | TaskParallelModeDisabled
  | TaskClosed
  | TaskReopened
  | TaskRetroRecorded
  | TaskEstimateRevised;

export const TASK_EVENT_TYPES: readonly TaskEvent['type'][] = [
  'task.created',
  'task.started',
  'task.attached',
  'task.estimated',
  'task.manual-time-recorded',
  'task.extra-recorded',
  'task.parallel-mode-enabled',
  'task.parallel-mode-disabled',
  'task.closed',
  'task.reopened',
  'task.retro-recorded',
  'task.estimate-revised',
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
