import type { PlanRevised } from '../../domain/progress/progress-records.js';
import type { Task } from '../../domain/task/task.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import type { PlanSnapshots } from './plan-snapshots.js';

export interface PlanRevisedWriter {
  readonly journal: Pick<EventJournal, 'appendRecord'>;
  readonly snapshots: PlanSnapshots;
  readonly meta: EventMetaSource;
}

/** The plan snapshot of a revision, written after its event (estimate-revision spec). */
export function writePlanRevised(writer: PlanRevisedWriter, task: Task, revision: string, where: WorkingCopy): void {
  const meta = writer.meta.next();
  writer.journal.appendRecord(
    journalEntry<PlanRevised>(
      'plan.revised',
      { source: CORE_SOURCE, revision, projects: writer.snapshots.started(task, task.startedAt ?? meta.at, where) },
      { id: meta.id, at: meta.at, author: meta.author, project: task.homeProject.value, task: task.id.toString() },
    ),
  );
}
