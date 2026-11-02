import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { TaskCards } from './task-cards.js';

export interface RebuildReport {
  readonly tasks: number;
  readonly cards: number;
  readonly failed: readonly { readonly task: string; readonly error: string }[];
  /** Why calibration.json was not written, if it was not. */
  readonly calibrationError?: string;
}

/**
 * `emt rebuild`: snapshots, cards and the calibration again from the journals.
 * A broken task is reported and the rest go on.
 */
export class Rebuild {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly cards: TaskCards,
  ) {}

  execute(input: { readonly task?: TaskId }): RebuildReport {
    const ids = input.task ? [input.task] : this.tasks.ids();
    const failed: { task: string; error: string }[] = [];
    let cards = 0;
    for (const id of ids) {
      try {
        const task = this.tasks.rebuild(id);
        if (task && this.cards.refresh(task)) {
          cards += 1;
        }
      } catch (error) {
        failed.push({ task: id.toString(), error: error instanceof Error ? error.message : String(error) });
      }
    }
    try {
      this.cards.recalculate();
    } catch (error) {
      return { tasks: ids.length, cards, failed, calibrationError: error instanceof Error ? error.message : String(error) };
    }
    return { tasks: ids.length, cards, failed };
  }
}
