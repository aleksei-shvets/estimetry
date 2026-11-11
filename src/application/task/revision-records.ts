import type { ExcludedArchives } from '../../domain/estimate/estimate-revision.js';
import type { PlanRevised } from '../../domain/progress/progress-records.js';
import type { Task } from '../../domain/task/task.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import type { PlanSnapshots } from './plan-snapshots.js';

/** What follows the event of a revision (estimate-revision spec): its plan snapshot, and a proposal to close that no longer holds. */
export class RevisionRecords {
  constructor(
    private readonly journal: Pick<EventJournal, 'appendRecord' | 'readRecords'>,
    private readonly snapshots: PlanSnapshots,
    private readonly proposals: Pick<CloseProposals, 'peek' | 'remove'>,
    private readonly meta: EventMetaSource,
  ) {}

  /** The plan snapshot of a revision, written after its event. */
  planRevised(task: Task, revision: string, where: WorkingCopy): void {
    const meta = this.meta.next();
    this.journal.appendRecord(
      journalEntry<PlanRevised>(
        'plan.revised',
        { source: CORE_SOURCE, revision, projects: this.snapshots.started(task, task.startedAt ?? meta.at, where) },
        { id: meta.id, at: meta.at, author: meta.author, project: task.homeProject.value, task: task.id.toString() },
      ),
    );
  }

  /** Revisions whose plan snapshot is in the journal. */
  withPlan(task: Task): ReadonlySet<string> {
    return new Set(this.journal.readRecords(task.id).flatMap((record) => (record.type === 'plan.revised' ? [record.data.revision] : [])));
  }

  /** A proposal to close about a change that was rolled back would ask about work thrown away. */
  dropProposal(task: Task, excluded: readonly ExcludedArchives[]): void {
    const pending = this.proposals.peek(task.id.toString());
    const about = (project: ExcludedArchives) =>
      (pending?.project === undefined || pending.project === project.project) &&
      project.archives.some((archive) => archive.change === pending?.change);
    if (pending !== undefined && excluded.some(about)) {
      this.proposals.remove(task.id.toString());
    }
  }
}
