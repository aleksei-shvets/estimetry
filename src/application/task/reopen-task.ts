import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { TaskCards } from './task-cards.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface TaskReopened {
  readonly task: TaskView;
  readonly warnings: readonly string[];
}

/** `emt reopen`: undoes a closing made by mistake; the card goes, the calibration follows. */
export class ReopenTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly cards: TaskCards,
    private readonly proposals: CloseProposals,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: { readonly task: TaskId }): TaskReopened {
    const task = retryOnConflict(() => {
      const task = this.tasks.get(input.task);
      task.reopen(this.meta.next());
      this.tasks.save(task);
      return task;
    });
    const warnings = derived([
      ['removing the pending close proposal', () => this.proposals.remove(task.id.toString())],
      ['removing the card', () => this.cards.refresh(task)],
      ['updating calibration.json', () => this.cards.recalculate()],
    ]);
    return { task: toTaskView(task), warnings };
  }
}

/** Runs derived steps; a failure becomes a warning, since `emt rebuild` can repeat it. */
export function derived(steps: readonly (readonly [string, () => unknown])[]): string[] {
  const warnings: string[] = [];
  for (const [what, run] of steps) {
    try {
      run();
    } catch (error) {
      warnings.push(`${what} failed (${error instanceof Error ? error.message : String(error)}); run \`emt rebuild\``);
    }
  }
  return warnings;
}
