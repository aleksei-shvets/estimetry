import type { Duration } from '../../domain/measurement/duration.js';
import type { ThreePointData } from '../../domain/estimate/three-point-estimate.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { PlanProgress } from '../../domain/progress/plan-progress.js';
import type { PlanUnavailable } from '../ports/project-plans.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskMeasurement } from './task-measurement.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { CompletedChange, TaskPlanProgress, UntrackedProject } from './task-plan-progress.js';

/** Effort of a task for `emt status`. Durations are whole minutes; shares are fractions, null when undefined. */
export interface StatusView {
  readonly task: { readonly id: string; readonly title: string; readonly status: string; readonly startedAt?: string };
  readonly fact: number;
  readonly agentTime: number;
  readonly userTime: number;
  readonly uncertainty: number;
  readonly uncertaintyShare: number | null;
  readonly uncertaintyExceedsTarget: boolean;
  readonly manualTime: number;
  readonly manualShare: number | null;
  /** Hours of the estimate; null without one. */
  readonly estimate: ThreePointData | null;
  /** Fact over the most likely estimate. */
  readonly estimateShare: number | null;
  readonly agentWork: number;
  readonly calendar: number;
  readonly parallel: {
    readonly used: boolean;
    readonly maxAgents: number | null;
    readonly sequentialEquivalent: number | null;
  };
  readonly records: {
    readonly manual: number;
    readonly extras: number;
    /** Minutes of extra work the user put a cost on, by category. */
    readonly extraMinutesByCategory: Readonly<Record<string, number>>;
  };
  /** Progress of the plan over the task's projects; null when it cannot be counted. */
  readonly plan: PlanView | null;
  readonly planUnavailable: PlanUnavailable | null;
  /** Projects of the task whose plan cannot be read here; with a plan their groups may look not started. */
  readonly untrackedProjects: readonly UntrackedProject[];
  readonly completedChanges: readonly CompletedChange[];
}

export interface PlanView {
  readonly done: number;
  readonly mode: PlanProgress['mode'];
  readonly groupedHours: number | null;
  readonly estimateHours: number | null;
  readonly notStarted: readonly string[];
  readonly possibleTypos: PlanProgress['possibleTypos'];
  readonly archivedBeforeStart: readonly string[];
}

export class ShowStatus {
  constructor(
    private readonly activeTask: ResolveActiveTask,
    private readonly measurement: TaskMeasurement,
    private readonly plans: TaskPlanProgress,
    private readonly journal: Pick<EventJournal, 'readAll'>,
  ) {}

  execute(input: { readonly task?: TaskId }): StatusView {
    const task = this.activeTask.inProgress(input.task);
    // One read of the journal for the fact and the completions.
    const journal = task.startedAt === undefined ? undefined : this.journal.readAll(task.id);
    const report = this.measurement.measure(task, journal?.activity ?? []);
    const estimate = task.estimate?.total;
    const extras = task.extras;
    const extraMinutesByCategory: Record<string, number> = {};
    for (const extra of extras) {
      if (extra.time !== undefined) {
        extraMinutesByCategory[extra.category] = (extraMinutesByCategory[extra.category] ?? 0) + minutes(extra.time);
      }
    }
    const startedAt = task.startedAt?.toISOString();
    const progress = this.plans.of(task, { records: journal?.records ?? [] });
    const plan = progress.plan;
    return {
      task: {
        id: task.id.toString(),
        title: task.title,
        status: task.status,
        ...(startedAt === undefined ? {} : { startedAt }),
      },
      fact: minutes(report.fact),
      agentTime: minutes(report.agentTime),
      userTime: minutes(report.userTime),
      uncertainty: minutes(report.uncertainty),
      uncertaintyShare: report.uncertaintyShare ?? null,
      uncertaintyExceedsTarget: report.exceedsUncertaintyTarget,
      manualTime: minutes(report.manualTime),
      manualShare: report.manualShare ?? null,
      estimate: estimate?.toData() ?? null,
      estimateShare: estimate === undefined || report.fact.millis === 0 ? null : report.fact.hours / estimate.likely,
      agentWork: minutes(report.agentWork),
      calendar: minutes(report.calendar),
      parallel: {
        used: report.parallel.used,
        maxAgents: report.parallel.maxAgents ?? null,
        sequentialEquivalent: report.sequentialEquivalent === undefined ? null : minutes(report.sequentialEquivalent),
      },
      records: { manual: task.manualTime.length, extras: extras.length, extraMinutesByCategory },
      plan:
        plan === undefined
          ? null
          : {
              done: plan.done,
              mode: plan.mode,
              groupedHours: plan.groupedHours ?? null,
              estimateHours: plan.estimateHours ?? null,
              notStarted: plan.notStarted,
              possibleTypos: plan.possibleTypos,
              archivedBeforeStart: plan.archivedBeforeStart,
            },
      planUnavailable: progress.unavailable ?? null,
      untrackedProjects: progress.untracked,
      completedChanges: progress.completed,
    };
  }
}

function minutes(duration: Duration): number {
  return Math.round(duration.minutes);
}
