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
  readonly closedAt?: string;
  readonly outcome?: string;
  readonly spawnedFrom?: string;
  readonly spawned?: string;
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
    ...closing(task),
    ...(task.spawnedFrom === undefined ? {} : { spawnedFrom: task.spawnedFrom }),
  };
}

function closing(task: Task): Partial<TaskView> {
  const closure = task.closure;
  return closure === undefined
    ? {}
    : { closedAt: closure.at, outcome: closure.outcome, ...(closure.spawned === undefined ? {} : { spawned: closure.spawned }) };
}
