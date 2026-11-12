import type { Task } from '../../domain/task/task.js';

/**
 * The changes of a task that pick its working copy (plan-progress spec): the
 * groups of its current estimate and of the one it started with, so a copy is
 * still found by a change a revision dropped.
 */
export function changesOf(task: Task): readonly string[] {
  return [...new Set([...(task.estimate?.groups ?? []), ...(task.originalEstimate?.groups ?? [])])];
}
