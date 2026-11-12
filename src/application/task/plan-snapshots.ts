import { planProgress } from '../../domain/progress/plan-progress.js';
import type { ProjectPlanSnapshot } from '../../domain/progress/progress-records.js';
import { taskPlan } from '../../domain/progress/task-plan.js';
import type { ProjectRepository } from '../../domain/project/project-repository.js';
import { CalendarDate } from '../../domain/shared/calendar-date.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { GitHead } from '../ports/git-snapshot.js';
import type { ProjectPlanReading, ProjectPlans } from '../ports/project-plans.js';
import { nearOf, type WorkingCopy } from '../shared/working-copy.js';

export interface ClosingPlan {
  readonly projects: readonly ProjectPlanSnapshot[];
  readonly done?: number;
  readonly completedGroups: readonly string[];
  readonly unfinishedGroups: readonly string[];
  readonly stack: readonly string[];
}

/**
 * Snapshots of a task's plan written into its journal at the start and at the
 * closing, so the card never reads the files of the flow again (task-cards spec).
 */
export class PlanSnapshots {
  constructor(
    private readonly plans: Pick<ProjectPlans, 'plans'>,
    private readonly git: GitHead,
    private readonly projects: Pick<ProjectRepository, 'findById'>,
  ) {}

  started(task: Task, startedAt: Timestamp, where: WorkingCopy = {}): ProjectPlanSnapshot[] {
    return this.read(task, startedAt, where).map((reading) => this.snapshot(reading));
  }

  closing(task: Task, where: WorkingCopy = {}): ClosingPlan {
    const startedAt = task.startedAt;
    const readings = startedAt === undefined ? [] : this.read(task, startedAt, where);
    const available = readings.filter((reading) => reading.changes !== undefined);
    const plan =
      startedAt === undefined
        ? undefined
        : taskPlan(
            available.map((reading) => ({ project: reading.project.value, changes: reading.changes ?? [] })),
            startedAt,
            task.planExclusions,
          );
    const progress = plan === undefined || available.length === 0 ? undefined : planProgress(task.estimate, plan);
    const groups = [...new Set((task.estimate?.parts ?? []).flatMap((part) => (part.group === undefined ? [] : [part.group])))];
    const completed = groups.filter((group) => {
      const changes = plan?.changes.filter((change) => change.change === group) ?? [];
      return changes.length > 0 && changes.every((change) => change.archived);
    });
    const stack = [
      ...new Set(
        task.projects.flatMap((project) => this.projects.findById(project)?.stack ?? []),
      ),
    ].sort();
    return {
      projects: readings.map((reading) => this.snapshot(reading)),
      ...(progress === undefined ? {} : { done: progress.done }),
      completedGroups: completed,
      unfinishedGroups: groups.filter((group) => !completed.includes(group)),
      stack,
    };
  }

  private read(task: Task, startedAt: Timestamp, where: WorkingCopy): ProjectPlanReading[] {
    return this.plans.plans(task.projects, {
      ...nearOf(where),
      archivedSince: CalendarDate.of(startedAt).minusDays(1),
    });
  }

  private snapshot(reading: ProjectPlanReading): ProjectPlanSnapshot {
    const head = reading.root === undefined ? undefined : this.git.head(reading.root);
    return {
      project: reading.project.value,
      ...(reading.changes === undefined ? {} : { changes: reading.changes }),
      ...(head === undefined ? {} : { head }),
      ...(reading.unavailable === undefined ? {} : { unavailable: reading.unavailable }),
    };
  }
}
