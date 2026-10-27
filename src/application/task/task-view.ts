import type { Task } from '../../domain/task/task.js';

/** What use cases return about a task; presenters render it as text or JSON. */
export interface TaskView {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly ticket?: string;
  readonly status: string;
  readonly estimated: boolean;
  readonly projects: readonly string[];
  readonly author: string;
  readonly createdAt: string;
  readonly startedAt?: string;
}

export function toTaskView(task: Task): TaskView {
  const { schemaVersion: _schemaVersion, version: _version, lastEventId: _lastEventId, ...view } = task.toSnapshot();
  return view;
}
