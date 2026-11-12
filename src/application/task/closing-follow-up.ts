import type { SessionUnbound } from '../../domain/measurement/activity-events.js';
import type { Task } from '../../domain/task/task.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';
import { derivedWarning } from './derived-steps.js';
import type { TaskCards } from './task-cards.js';

/** The steps after `task.closed`: each derived from the journal, each may fail on its own. */
export class ClosingFollowUp {
  constructor(
    private readonly journal: Pick<EventJournal, 'append'>,
    private readonly bindings: Pick<SessionBindings, 'ofProject' | 'update'>,
    private readonly proposals: Pick<CloseProposals, 'remove'>,
    private readonly cards: Pick<TaskCards, 'refresh' | 'recalculate'>,
    private readonly meta: EventMetaSource,
  ) {}

  /**
   * After `task.closed`: sessions let go of the task, a pending proposal goes,
   * the card and the calibration are written. Each step may fail on its own;
   * the failures come back as warnings, and `emt rebuild` repeats the derived ones.
   */
  finish(task: Task): string[] {
    const warnings: string[] = [];
    const step = (what: string, run: () => void) => {
      try {
        run();
      } catch (error) {
        warnings.push(derivedWarning(what, error));
      }
    };
    step('releasing the sessions of the task', () => this.release(task));
    step('removing the pending close proposal', () => this.proposals.remove(task.id));
    step('writing the card', () => this.cards.refresh(task));
    step('updating calibration.json', () => this.cards.recalculate());
    return warnings;
  }

  /** Every session bound to the task is unbound at the closing moment and stays so until it starts again. */
  private release(task: Task): void {
    const id = task.id;
    const closedAt = task.requireClosedAt();
    for (const project of task.projects) {
      for (const binding of this.bindings.ofProject(project)) {
        if (binding.task?.equals(id) !== true) {
          continue;
        }
        const session = binding.session;
        let released = false;
        this.bindings.update(session, (current) => {
          if (current?.task?.equals(id) !== true) {
            return undefined;
          }
          released = true;
          return { session: current.session, project: current.project, root: current.root, everBound: true, closedTask: id };
        });
        if (released) {
          this.journal.append(
            journalEntry<SessionUnbound>(
              'session.unbound',
              { source: CORE_SOURCE, session: session.value },
              { ...this.meta.at(closedAt), project: binding.project, task: id },
            ),
          );
        }
      }
    }
  }
}
