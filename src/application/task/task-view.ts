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

/**
 * Fields are listed one by one, so a new snapshot field does not change the JSON of
 * `task list/show` by accident. Records of the task are shown by `status`, not here.
 */
export function toTaskView(task: Task): TaskView {
  const s = task.toSnapshot();
  return {
    id: s.id,
    title: s.title,
    type: s.type,
    ...(s.ticket === undefined ? {} : { ticket: s.ticket }),
    status: s.status,
    estimated: s.estimated,
    projects: s.projects,
    author: s.author,
    createdAt: s.createdAt,
    ...(s.startedAt === undefined ? {} : { startedAt: s.startedAt }),
  };
}
