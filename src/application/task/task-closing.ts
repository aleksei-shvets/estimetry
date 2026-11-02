import type { SessionUnbound } from '../../domain/measurement/activity-events.js';
import type { CodeMeasured, PlanClosing } from '../../domain/progress/progress-records.js';
import { SessionId } from '../../domain/measurement/session-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import { journalEntry } from '../hooks/journal-entry.js';
import { CORE_SOURCE } from '../hooks/session-task.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { Clock } from '../ports/clock.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { CodeVolumeService } from './code-volume-service.js';
import type { PlanSnapshots } from './plan-snapshots.js';
import { derivedWarning } from './derived-steps.js';
import type { TaskCards } from './task-cards.js';

/** Steps around `task.closed`, shared by `emt close` and `emt renegotiate`. */
export class TaskClosing {
  constructor(
    private readonly journal: EventJournal,
    private readonly code: CodeVolumeService,
    private readonly plans: PlanSnapshots,
    private readonly bindings: SessionBindings,
    private readonly proposals: CloseProposals,
    private readonly cards: TaskCards,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly authors: AuthorProvider,
  ) {}

  /**
   * What cannot be measured later goes into the journal before the task
   * closes: the code volume and the plan. A closing that fails after this
   * leaves records that the next closing supersedes.
   */
  prepare(task: Task, near: string | undefined): void {
    const now = this.clock.now();
    const records = this.journal.readRecords(task.id);
    this.journal.appendRecord(
      journalEntry<CodeMeasured>(
        'code.measured',
        { source: CORE_SOURCE, measuredAt: now.toISOString(), projects: this.code.measure(task, records, near) },
        this.meta(task, now),
      ),
    );
    this.journal.appendRecord(journalEntry<PlanClosing>('plan.closing', { source: CORE_SOURCE, ...this.plans.closing(task, near) }, this.meta(task, now)));
  }

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
    step('removing the pending close proposal', () => this.proposals.remove(task.id.toString()));
    step('writing the card', () => this.cards.refresh(task));
    step('updating calibration.json', () => this.cards.recalculate());
    return warnings;
  }

  /** Every session bound to the task is unbound at the closing moment and stays so until it starts again. */
  private release(task: Task): void {
    const id = task.id.toString();
    const closedAt = task.closedAt as Timestamp;
    for (const project of task.projects) {
      for (const binding of this.bindings.ofProject(project)) {
        if (binding.task !== id) {
          continue;
        }
        const session = SessionId.parse(binding.session);
        let released = false;
        this.bindings.update(session, (current) => {
          if (current?.task !== id) {
            return undefined;
          }
          released = true;
          return { session: current.session, project: current.project, root: current.root, everBound: true, closedTask: id };
        });
        if (released) {
          this.journal.append(
            journalEntry<SessionUnbound>('session.unbound', { source: CORE_SOURCE, session: session.value }, {
              id: this.ids.next(),
              at: closedAt,
              author: this.authors.current(),
              project: binding.project,
              task: id,
            }),
          );
        }
      }
    }
  }

  private meta(task: Task, at: Timestamp) {
    return { id: this.ids.next(), at, author: this.authors.current(), project: task.homeProject.value, task: task.id.toString() };
  }
}
