import type { SessionUnbound } from '../../domain/measurement/activity-events.js';
import type { CodeMeasured, PlanClosing } from '../../domain/progress/progress-records.js';
import { SessionId } from '../../domain/measurement/session-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { Clock } from '../ports/clock.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { CodeVolumeService } from './code-volume-service.js';
import type { PlanSnapshots } from './plan-snapshots.js';
import { derivedWarning } from './derived-steps.js';
import type { ImportSessionLogs } from './import-session-logs.js';
import type { TaskCards } from './task-cards.js';
import type { WorkingCopy } from '../shared/working-copy.js';

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
    /** The importer of session logs; only the closing calls it. */
    private readonly logs?: () => ImportSessionLogs,
  ) {}

  /**
   * What cannot be measured later goes into the journal before the task
   * closes: the logs of its sessions, the code volume and the plan. A closing
   * that fails after this leaves records that the next closing supersedes.
   * `recordedAt` is the moment `task.closed` is written: the records of the
   * logs carry it, so they never fall after the closing. Returns warnings of
   * logs that could not be imported.
   */
  prepare(task: Task, recordedAt: Timestamp, where: WorkingCopy = {}): string[] {
    const warnings = this.importLogs(task, recordedAt);
    const now = this.clock.now();
    const records = this.journal.readRecords(task.id);
    this.journal.appendRecord(
      journalEntry<CodeMeasured>(
        'code.measured',
        { source: CORE_SOURCE, measuredAt: now.toISOString(), projects: this.code.measure(task, records, where) },
        this.meta(task, now),
      ),
    );
    this.journal.appendRecord(journalEntry<PlanClosing>('plan.closing', { source: CORE_SOURCE, ...this.plans.closing(task, where) }, this.meta(task, now)));
    return warnings;
  }

  /** Every session of the task, without a time budget: the user waits for the closing anyway. */
  private importLogs(task: Task, recordedAt: Timestamp): string[] {
    if (this.logs === undefined) {
      return [];
    }
    const importer = this.logs();
    const sessions = new Map<string, string>();
    for (const event of this.journal.readActivity(task.id)) {
      if (!sessions.has(event.data.session) && event.data.source !== CORE_SOURCE) {
        sessions.set(event.data.session, event.data.source);
      }
    }
    const warnings: string[] = [];
    for (const [session, source] of sessions) {
      let id: SessionId;
      try {
        id = SessionId.parse(session);
      } catch {
        continue; // not an id a tool gives: it never names a log, and it must not name a file
      }
      const path = this.bindings.get(id)?.transcript;
      const [result] = importer.execute({
        session,
        source,
        at: recordedAt,
        ...(path === undefined ? {} : { path }),
        tasks: [{ id: task.id.toString(), project: task.homeProject.value }],
      });
      if (result !== undefined && (result.outcome === 'failed' || result.outcome === 'unrecognized')) {
        warnings.push(`the log of session ${session} was not imported (${result.outcome}); the fact goes without it`);
      }
    }
    return warnings;
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
