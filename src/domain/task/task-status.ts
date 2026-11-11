/**
 * Task lifecycle: new → (estimated) → in-progress → (closed).
 * `estimated` and `closed` are reached by later changes; they are listed here
 * so that stored snapshots stay valid across versions.
 */
export const TASK_STATUSES = ['new', 'estimated', 'in-progress', 'closed'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export const STARTABLE_STATUSES: readonly TaskStatus[] = ['new', 'estimated'];

/** For a status read from a snapshot, without the aggregate: hooks and readers of summaries. */
export function isInProgress(status: TaskStatus): boolean {
  return status === 'in-progress';
}

export function isClosed(status: TaskStatus): boolean {
  return status === 'closed';
}
