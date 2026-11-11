import { EstimateRevision, type ExcludedArchives } from '../../domain/estimate/estimate-revision.js';
import type { ThreePointData } from '../../domain/estimate/three-point-estimate.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import { TaskType } from '../../domain/task/task-type.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { EstimateReader } from '../ports/estimate-reader.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { ProjectFiles } from '../ports/project-files.js';
import type { ProjectPlans } from '../ports/project-plans.js';
import { CalendarDate } from '../../domain/shared/calendar-date.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import { nearOf, type WorkingCopy } from '../shared/working-copy.js';
import { revisionCandidatesOf, type RevisionCandidates } from './find-revision-candidates.js';
import { writePlanRevised } from './plan-revised.js';
import type { PlanSnapshots } from './plan-snapshots.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface ReviseEstimateInput extends WorkingCopy {
  readonly task?: TaskId;
  readonly file: string;
  readonly reason: string;
  readonly category?: string;
  readonly spent?: string;
  readonly lostFrom?: Timestamp;
  readonly at?: Timestamp;
  readonly covers?: readonly string[];
}

export interface EstimateRevised {
  readonly task: TaskView;
  readonly total: ThreePointData;
  readonly firstEstimate: boolean;
  readonly spent: string | null;
  readonly lostFrom: string | null;
  readonly at: string;
  readonly excluded: readonly ExcludedArchives[];
  readonly covers: readonly string[];
  readonly candidates: RevisionCandidates;
}

/**
 * `emt estimate revise` (estimate-revision spec): a new estimate of a task in
 * progress. The aggregate checks the moments; this use case reads the archive
 * for `exclude`, writes the plan snapshot after the event and drops a pending
 * proposal to close about a change that was rolled back.
 */
export class ReviseEstimate {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activeTask: ResolveActiveTask,
    private readonly reader: EstimateReader,
    private readonly taskTypes: TaskTypeCatalog,
    private readonly plans: Pick<ProjectPlans, 'archives'>,
    private readonly files: Pick<ProjectFiles, 'changedAt'>,
    private readonly snapshots: PlanSnapshots,
    private readonly journal: Pick<EventJournal, 'appendRecord' | 'readRecords'>,
    private readonly proposals: Pick<CloseProposals, 'peek' | 'remove'>,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: ReviseEstimateInput): EstimateRevised {
    const estimate = this.reader.read(input.file);
    const type = estimate.type === undefined ? undefined : TaskType.of(estimate.type, this.taskTypes.allowed());
    let revisionId = '';
    let at = '';
    let excluded: ExcludedArchives[] = [];
    const task = retryOnConflict(() => {
      const task = this.activeTask.inProgress(input.task);
      const meta = this.meta.next();
      const revisedAt = input.at ?? meta.at;
      const from = input.lostFrom ?? task.lostWindowFloor;
      // Only a task that already has an estimate is revised; its first estimate reads no archive.
      excluded = input.spent === 'exclude' && task.estimate !== undefined && from !== undefined ? this.archives(task, from, revisedAt, input) : [];
      task.reviseEstimate(
        EstimateRevision.of({
          estimate,
          ...(type === undefined ? {} : { type: type.value }),
          reason: input.reason,
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.spent === undefined ? {} : { spent: input.spent }),
          at: input.at ?? meta.at,
          ...(input.lostFrom === undefined ? {} : { lostFrom: input.lostFrom }),
          ...(input.covers === undefined ? {} : { covers: input.covers }),
          excluded,
        }),
        meta,
      );
      revisionId = meta.id;
      at = (input.at ?? meta.at).toISOString();
      this.tasks.save(task);
      return task;
    });
    const revision = task.revisions.find((item) => item.id === revisionId);
    if (revision !== undefined) {
      writePlanRevised({ journal: this.journal, snapshots: this.snapshots, meta: this.meta }, task, revisionId, input);
      this.dropProposal(task, excluded);
    }
    const lostFrom = revision?.lostFrom;
    return {
      task: toTaskView(task),
      total: estimate.total.toData(),
      firstEstimate: revision === undefined,
      spent: revision?.spent ?? null,
      lostFrom: lostFrom?.toISOString() ?? null,
      at,
      excluded: revision?.excluded ?? [],
      covers: revision?.covers ?? [],
      candidates: revisionCandidatesOf(task, lostFrom, this.meta.next().at),
    };
  }

  /**
   * Archived changes of the lost window, by project: only what was archived
   * between `from` and `at` (by the time its directory changed, else by its
   * date), so work archived before the window or after the revision still counts.
   * Projects not readable here are left out: they count from the day of the revision.
   */
  private archives(task: Task, from: Timestamp, at: Timestamp, where: WorkingCopy): ExcludedArchives[] {
    const fromDay = CalendarDate.of(from).minusDays(1);
    const atDay = CalendarDate.of(at);
    return this.plans.archives(task.projects.map((project) => project.value), nearOf(where)).flatMap((reading) => {
      if (reading.archived === undefined) {
        return [];
      }
      const archives = reading.archived.flatMap((dir) => {
        const changedAt = this.files.changedAt(dir.path);
        const inWindow =
          changedAt !== undefined && changedAt > 0
            ? changedAt >= from.toMillis() - 1_000 && changedAt <= at.toMillis() + 1_000
            : !dir.archivedOn.isBefore(fromDay) && !atDay.isBefore(dir.archivedOn);
        return inWindow ? [{ change: dir.change, archivedOn: dir.archivedOn.value, ...(changedAt === undefined ? {} : { changedAt }) }] : [];
      });
      return [{ project: reading.project, archives }];
    });
  }

  /** A proposal to close about a change that was rolled back would ask about work thrown away. */
  private dropProposal(task: Task, excluded: readonly ExcludedArchives[]): void {
    const pending = this.proposals.peek(task.id.toString());
    const about = (project: ExcludedArchives) =>
      (pending?.project === undefined || pending.project === project.project) && project.archives.some((archive) => archive.change === pending?.change);
    if (pending !== undefined && excluded.some(about)) {
      this.proposals.remove(task.id.toString());
    }
  }
}
