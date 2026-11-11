import { SessionId } from '../../domain/measurement/session-id.js';
import type { CodeMeasured, PlanClosing } from '../../domain/progress/progress-records.js';
import type { EventMeta } from '../../domain/shared/event-envelope.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import type { CodeVolumeService } from './code-volume-service.js';
import type { ImportSessionLogs } from './import-session-logs.js';
import type { PlanSnapshots } from './plan-snapshots.js';

/** The steps before `task.closed`: what cannot be measured later goes into the journal. */
export class ClosingRecords {
  constructor(
    private readonly journal: Pick<EventJournal, 'appendRecord' | 'readRecords' | 'readActivity'>,
    private readonly code: CodeVolumeService,
    private readonly plans: PlanSnapshots,
    private readonly bindings: Pick<SessionBindings, 'get'>,
    private readonly meta: EventMetaSource,
    /** The importer of session logs; only the closing calls it. */
    private readonly logs?: () => Pick<ImportSessionLogs, 'execute'>,
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
    const code = this.meta.next();
    const now = code.at;
    const records = this.journal.readRecords(task.id);
    this.journal.appendRecord(
      journalEntry<CodeMeasured>(
        'code.measured',
        { source: CORE_SOURCE, measuredAt: now.toISOString(), projects: this.code.measure(task, records, where) },
        ofTask(task, code),
      ),
    );
    this.journal.appendRecord(journalEntry<PlanClosing>('plan.closing', { source: CORE_SOURCE, ...this.plans.closing(task, where) }, ofTask(task, this.meta.at(now))));
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
}

function ofTask(task: Task, meta: EventMeta) {
  return { ...meta, project: task.homeProject.value, task: task.id.toString() };
}
