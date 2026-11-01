import { planProgress, type PlanProgress } from '../../domain/progress/plan-progress.js';
import type { ChangeCompleted, ProgressRecord } from '../../domain/progress/progress-records.js';
import { CalendarDate } from '../../domain/shared/calendar-date.js';
import { taskPlan } from '../../domain/progress/task-plan.js';
import type { Task } from '../../domain/task/task.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { PlanUnavailable, ProjectPlanReading, ProjectPlans } from '../ports/project-plans.js';

export interface CompletedChange {
  readonly project: string;
  readonly change: string;
  /** ISO 8601 in UTC. */
  readonly completedAt: string;
  readonly approximate: boolean;
}

/** A project of the task whose plan cannot be read here. */
export interface UntrackedProject {
  readonly project: string;
  readonly reason: PlanUnavailable;
  /** The flow named in the config, for `unknown-flow`. */
  readonly flow?: string;
}

export interface TaskPlanState {
  readonly plan?: PlanProgress;
  /** Why the plan cannot be counted, when it cannot. */
  readonly unavailable?: PlanUnavailable;
  /** Projects left out of the plan: with a plan their groups may look not started. */
  readonly untracked: readonly UntrackedProject[];
  /** By `completedAt`. */
  readonly completed: readonly CompletedChange[];
}

export interface PlanProgressOptions {
  /** The directory the reader works in: of several working copies of a project, the one containing it is read. */
  readonly near?: string;
  /** The task's progress records when the caller has already read the journal; without them none are read. */
  readonly records?: readonly ProgressRecord[];
  /** False to skip completions (and the journal) when only the percent is needed. */
  readonly completions?: boolean;
}

/** Progress of a task's plan over all its projects: the same numbers for `emt status`, the session start and `parallel on`. */
export class TaskPlanProgress {
  constructor(
    private readonly plans: Pick<ProjectPlans, 'plans'>,
    private readonly journal: Pick<EventJournal, 'readRecords'>,
    /** The directory the command runs in, when there is one. */
    private readonly near?: string,
  ) {}

  of(task: Task, options: PlanProgressOptions = {}): TaskPlanState {
    const startedAt = task.startedAt;
    if (startedAt === undefined) {
      return { untracked: [], completed: [] };
    }
    const near = options.near ?? this.near;
    const readings = this.plans.plans(task.projects, {
      ...(near === undefined ? {} : { near }),
      // Older archives only name groups `archived before start`: their tasks are not read.
      archivedSince: CalendarDate.of(startedAt).minusDays(1),
    });
    const untracked = readings.flatMap((reading) =>
      reading.unavailable === undefined
        ? []
        : [{ project: reading.project, reason: reading.unavailable, ...(reading.flow === undefined ? {} : { flow: reading.flow }) }],
    );
    const available = readings.filter((reading) => reading.changes !== undefined);
    if (available.length === 0) {
      // No project of the task has a readable plan here: "0% done" would be a guess.
      const unavailable = untracked[0]?.reason;
      return { ...(unavailable === undefined ? {} : { unavailable }), untracked, completed: [] };
    }
    const plan = planProgress(
      task.estimate,
      taskPlan(
        available.map((reading) => ({ project: reading.project, changes: reading.changes ?? [] })),
        startedAt,
      ),
    );
    const unavailable = plan === undefined ? untracked[0]?.reason : undefined;
    const completed =
      options.completions === false ? [] : this.completed(options.records ?? this.journal.readRecords(task.id), readings);
    return {
      ...(plan === undefined ? {} : { plan }),
      ...(unavailable === undefined ? {} : { unavailable }),
      untracked,
      completed,
    };
  }

  /**
   * Completions still standing: the directory is in the archive and no active
   * change of the same name overrides it. Of duplicate records the first counts.
   */
  private completed(records: readonly ProgressRecord[], readings: readonly ProjectPlanReading[]): CompletedChange[] {
    const byDirectory = new Map<string, CompletedChange>();
    for (const record of records) {
      if (record.type !== 'change.completed') {
        continue;
      }
      const key = `${record.data.project}\u0000${record.data.directory}`;
      if (!byDirectory.has(key) && standing(record, readings)) {
        byDirectory.set(key, {
          project: record.data.project,
          change: record.data.change,
          completedAt: record.data.completedAt,
          approximate: record.data.approximate,
        });
      }
    }
    return [...byDirectory.values()].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }
}

function standing(record: ChangeCompleted, readings: readonly ProjectPlanReading[]): boolean {
  const reading = readings.find((candidate) => candidate.project === record.data.project);
  if (reading?.archived === undefined) {
    return false; // the project's archive is not visible here: nothing to confirm it with
  }
  const archived = reading.archived.some((dir) => dir.directory === record.data.directory);
  const overridden = (reading.changes ?? []).some((change) => !change.archived && change.change === record.data.change);
  return archived && !overridden;
}
