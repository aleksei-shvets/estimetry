import { EstimateRevision, type ExcludedArchives } from '../../domain/estimate/estimate-revision.js';
import { LostWindow } from '../../domain/estimate/lost-window.js';
import type { ThreePointData } from '../../domain/estimate/three-point-estimate.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ChangeArchives } from '../shared/change-archives.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import type { EstimateFile } from './estimate-file.js';
import { revisionCandidatesOf, type RevisionCandidates } from './find-revision-candidates.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { RevisionRecords } from './revision-records.js';
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
    private readonly estimates: EstimateFile,
    private readonly archived: ChangeArchives,
    private readonly records: Pick<RevisionRecords, 'planRevised' | 'dropProposal'>,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: ReviseEstimateInput): EstimateRevised {
    const { estimate, type } = this.estimates.read(input.file);
    let revisionId = '';
    let at = '';
    let excluded: ExcludedArchives[] = [];
    const task = retryOnConflict(() => {
      const task = this.activeTask.inProgress(input.task);
      const meta = this.meta.next();
      const revisedAt = input.at ?? meta.at;
      const from = input.lostFrom ?? task.lostWindowFloor;
      // Only a task that already has an estimate is revised; its first estimate reads no archive.
      // A window that ends before it starts is the aggregate's to reject, with its own message.
      const window =
        input.spent === 'exclude' && task.estimate !== undefined && from !== undefined ? LostWindow.between(from, revisedAt) : undefined;
      excluded = window === undefined ? [] : this.archives(task, window, input);
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
      this.records.planRevised(task, revisionId, input);
      this.records.dropProposal(task, excluded);
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
   * Archived changes of the lost window, by project: work archived before the
   * window or after the revision still counts. Projects not readable here are
   * left out: they count from the day of the revision.
   */
  private archives(task: Task, window: LostWindow, where: WorkingCopy): ExcludedArchives[] {
    return this.archived.read(task.projects, where, task.changes).flatMap((reading) => {
      if (reading.archived === undefined) {
        return [];
      }
      const archives = reading.archived.flatMap((dir) => {
        const changedAt = this.archived.changedAt(dir);
        return window.holdsArchive({ archivedOn: dir.archivedOn, ...(changedAt === undefined ? {} : { changedAt }) })
          ? [{ change: dir.change, archivedOn: dir.archivedOn.value, ...(changedAt === undefined ? {} : { changedAt }) }]
          : [];
      });
      return [{ project: reading.project.value, archives }];
    });
  }
}

