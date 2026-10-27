import type { EventEnvelope, EventMeta } from '../shared/event-envelope.js';
import type { TaskId } from './task-id.js';

export const TASK_EVENT_SCHEMA_VERSION = 1;

export type TaskCreated = EventEnvelope<
  'task.created',
  { readonly title: string; readonly taskType: string; readonly ticket?: string }
>;

export type TaskStarted = EventEnvelope<'task.started', { readonly estimated: boolean }>;

export type TaskAttached = EventEnvelope<'task.attached', Record<string, never>>;

export type TaskEvent = TaskCreated | TaskStarted | TaskAttached;

export const TASK_EVENT_TYPES: readonly TaskEvent['type'][] = ['task.created', 'task.started', 'task.attached'];

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
