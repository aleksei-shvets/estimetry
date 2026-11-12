import type { ChangeCompleted, PlanBaseline, ProgressRecord } from '../../domain/progress/progress-records.js';
import { CalendarDate } from '../../domain/shared/calendar-date.js';
import { isExcluded } from '../../domain/progress/plan-exclusions.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { SessionId } from '../../domain/measurement/session-id.js';
import { ProjectId } from '../../domain/project/project-id.js';
import type { ArchivedChange } from '../ports/project-plans.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { ErrorReporter } from '../ports/error-reporter.js';
import type { ProgressSeen } from '../ports/progress-state.js';
import type { ProjectPlanReading } from '../ports/project-plans.js';
import type { TaskStatusReader, TaskSummary } from '../ports/task-status-reader.js';
import type { ChangeArchives } from '../shared/change-archives.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { journalEntry } from '../shared/journal-entry.js';
import type { ProgressLog } from './progress-log.js';

const SOURCE = 'estimetry';

/**
 * Notices changes of a task moved into the archive (plan-progress spec): one
 * listing of each project's archive per hook call, no `tasks.md`, no git.
 * The journal is the source of truth; the cache only spares reading it.
 */
export class ChangeCompletions {
  constructor(
    private readonly archives: ChangeArchives,
    private readonly progress: ProgressLog,
    private readonly tasks: Pick<TaskStatusReader, 'inProgress'>,
    private readonly meta: EventMetaSource,
    private readonly errors: ErrorReporter,
    private readonly proposals?: Pick<CloseProposals, 'put'>,
  ) {}

  /**
   * Never throws: a failed check is repeated on the next call. `near` is the
   * working copy of the session, `session` the one an exact completion is proposed to first.
   */
  check(task: TaskSummary, now: Timestamp, near?: string, session?: SessionId): void {
    try {
      this.run(task, now, near, session);
    } catch (error) {
      this.errors.report('change completions', error);
    }
  }

  private run(task: TaskSummary, now: Timestamp, near: string | undefined, session: SessionId | undefined): void {
    if (task.startedAt === undefined) {
      return;
    }
    const readings = this.archives
      .read(task.projects, near === undefined ? {} : { near })
      .filter((reading) => reading.archived !== undefined);
    if (readings.length === 0) {
      return;
    }
    const { seen, cached } = this.progress.seen(task.id);
    const startedAt = task.startedAt;
    const records: ProgressRecord[] = [];
    const directories: Record<string, readonly string[]> = { ...seen.directories };
    let changed = !cached;
    for (const reading of readings) {
      const project = reading.project.value;
      const firstRun = seen.directories[project] === undefined;
      const unseen = (reading.archived ?? []).filter((dir) => !seenIn(seen, project, dir.directory));
      if (!firstRun && unseen.length === 0) {
        continue;
      }
      const checked = this.checkProject(task, reading, unseen, firstRun, startedAt, now);
      records.push(...checked.records);
      if (firstRun || checked.settled.length > 0) {
        directories[project] = [...(seen.directories[project] ?? []), ...checked.settled];
        changed = true;
      }
    }
    this.progress.record(task.id, records, changed ? { directories } : undefined);
    // The latest exact completion is the one to ask about; approximate ones are old work.
    const exact = records
      .filter((record): record is ChangeCompleted => record.type === 'change.completed' && !record.data.approximate)
      .at(-1);
    if (exact !== undefined && session !== undefined && this.proposals !== undefined) {
      const completedAt = Timestamp.parse(exact.data.completedAt);
      this.proposals.put(task.id, { change: exact.data.change, project: ProjectId.parse(exact.data.project), completedAt, session });
    }
  }

  /**
   * Records for the unseen directories of one project and the ones settled by
   * them. A directory of another task is not settled: it is looked at again,
   * so the decision never depends on whether the cache survived.
   */
  private checkProject(
    task: TaskSummary,
    reading: ProjectPlanReading,
    unseen: readonly ArchivedChange[],
    firstRun: boolean,
    startedAt: Timestamp,
    now: Timestamp,
  ): { records: ProgressRecord[]; settled: string[] } {
    const windowStart = CalendarDate.of(startedAt).minusDays(1);
    const records: ProgressRecord[] = [];
    const settled: string[] = [];
    const baseline: string[] = [];
    let ours: ((change: string) => boolean) | undefined;
    for (const dir of unseen) {
      // Rolled back by a revision: settled, never a completion.
      if (
        task.exclusions !== undefined &&
        isExcluded(task.exclusions, reading.project.value, dir.change, dir.archivedOn.value, this.archives.changedAt(dir))
      ) {
        settled.push(dir.directory);
        continue;
      }
      if (dir.archivedOn.isBefore(windowStart)) {
        settled.push(dir.directory);
        if (firstRun) {
          baseline.push(dir.directory);
        }
        continue;
      }
      ours ??= this.belongs(task, reading.project);
      if (!ours(dir.change)) {
        continue;
      }
      // Only now a stat: a ctime older than the start means the directory was recreated (a clone), not moved.
      const changedAt = firstRun ? undefined : this.archives.changedAt(dir);
      const exact = changedAt !== undefined && changedAt >= startedAt.toMillis();
      const completedAt = exact ? Timestamp.fromMillis(Math.round(changedAt)) : Timestamp.parse(`${dir.archivedOn.value}T00:00:00.000Z`);
      settled.push(dir.directory);
      records.push(
        journalEntry<ChangeCompleted>(
          'change.completed',
          {
            source: SOURCE,
            project: reading.project.value,
            change: dir.change,
            directory: dir.directory,
            flow: reading.flow ?? 'unknown',
            completedAt: completedAt.toISOString(),
            detectedAt: now.toISOString(),
            approximate: !exact,
          },
          this.recordMeta(task, reading.project, now),
        ),
      );
    }
    if (firstRun) {
      records.unshift(
        journalEntry<PlanBaseline>(
          'plan.baseline',
          { source: SOURCE, project: reading.project.value, directories: baseline },
          this.recordMeta(task, reading.project, now),
        ),
      );
    }
    return { records, settled };
  }
  /** The changes of the task's groups; a task without groups owns a change only as the one task in progress there. */
  private belongs(task: TaskSummary, project: ProjectId): (change: string) => boolean {
    const groups = task.groups ?? [];
    if (groups.length > 0) {
      return (change) => groups.includes(change);
    }
    const inProgress = this.tasks.inProgress(project);
    const alone = inProgress.length === 1 && inProgress[0]?.id.equals(task.id) === true;
    return () => alone;
  }

  private recordMeta(task: TaskSummary, project: ProjectId, now: Timestamp) {
    return { ...this.meta.at(now), project, task: task.id };
  }
}

function seenIn(seen: ProgressSeen, project: string, directory: string): boolean {
  return seen.directories[project]?.includes(directory) ?? false;
}
