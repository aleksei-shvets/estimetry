import type { CardUsage } from '../../domain/card/card.js';
import type { Duration } from '../../domain/measurement/duration.js';
import { usageSummary, type TaskUsage } from '../../domain/usage/task-usage.js';
import type { ThreePointData } from '../../domain/estimate/three-point-estimate.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { Task } from '../../domain/task/task.js';
import type { Extra } from '../../domain/measurement/extra.js';
import type { EffortReport } from '../../domain/measurement/effort-report.js';
import type { PlanProgress } from '../../domain/progress/plan-progress.js';
import type { PlanUnavailable } from '../ports/project-plans.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskMeasurement } from './task-measurement.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { CompletedChange, TaskPlanProgress, UntrackedProject } from './task-plan-progress.js';
import { nearOf, type WorkingCopy } from '../shared/working-copy.js';

/** Effort of a task for `emt status`. Durations are whole minutes; shares are fractions, null when undefined. */
export interface StatusView {
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly startedAt?: string;
    /** A closed task is measured up to this moment. */
    readonly closedAt?: string;
  };
  readonly fact: number;
  readonly agentTime: number;
  readonly userTime: number;
  /** Bounds of the fact: without the counted doubtful stretches and with the discarded ones. */
  readonly factLow: number;
  readonly factHigh: number;
  /** Width of the range. */
  readonly uncertainty: number;
  readonly uncertaintyShare: number | null;
  readonly uncertaintyExceedsTarget: boolean;
  readonly manualTime: number;
  readonly manualShare: number | null;
  /** Hours of the estimate; null without one. */
  readonly estimate: ThreePointData | null;
  /** Fact over the most likely estimate. */
  readonly estimateShare: number | null;
  readonly counted: CountedFact;
  /** Minutes of work thrown away by revisions: the whole fact minus the counted one. */
  readonly lost: number;
  readonly revisions: readonly RevisionView[];
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
  /** Tokens and cost from the logs of the task's sessions; null when none has a log. */
  readonly usage: UsageView | null;
}

/** The same shape as the usage of a card. */
export type UsageView = CardUsage;

export interface PlanView {
  readonly done: number;
  readonly mode: PlanProgress['mode'];
  readonly groupedHours: number | null;
  readonly estimateHours: number | null;
  readonly notStarted: readonly string[];
  readonly possibleTypos: PlanProgress['possibleTypos'];
  readonly archivedBeforeStart: readonly string[];
  readonly archivedBeforeRevision: readonly string[];
}

/** The fact compared with the estimate: without work thrown away by revisions. Minutes. */
export interface CountedFact {
  readonly fact: number;
  readonly agentTime: number;
  readonly userTime: number;
  readonly manualTime: number;
  readonly factLow: number;
  readonly factHigh: number;
  readonly uncertainty: number;
  readonly agentWork: number;
  readonly uncertaintyShare: number | null;
  readonly uncertaintyExceedsTarget: boolean;
  readonly manualShare: number | null;
}

export interface RevisionView {
  readonly at: string;
  readonly lostFrom: string | null;
  readonly category: string | null;
  readonly spent: string | null;
  readonly baseLikelyBefore: number | null;
  readonly baseLikelyAfter: number;
  readonly covers: readonly string[];
  /** The plan snapshot of the revision was not written; `emt estimate revise --repair` writes it. */
  readonly missingSnapshot: boolean;
}

export class ShowStatus {
  constructor(
    private readonly activeTask: ResolveActiveTask,
    private readonly measurement: TaskMeasurement,
    private readonly plans: TaskPlanProgress,
    private readonly journal: Pick<EventJournal, 'readAll'>,
  ) {}

  execute(input: { readonly task?: TaskId } & WorkingCopy): StatusView {
    const task = this.activeTask.inProgress(input.task);
    // One read of the journal for the fact and the completions.
    const journal = task.startedAt === undefined ? undefined : this.journal.readAll(task.id);
    const report = this.measurement.measure(task, journal);
    // Without lost windows the counted fact is the whole one: the timeline is built once.
    const counted = task.lostWindows.length === 0 ? report : this.measurement.counted(task, journal);
    const snapshots = new Set(
      (journal?.records ?? []).flatMap((record) => (record.type === 'plan.revised' ? [record.data.revision] : [])),
    );
    const estimate = task.estimate?.total;
    const extras = task.extras;
    const progress = this.plans.of(task, { records: journal?.records ?? [], ...nearOf(input) });
    const plan = progress.plan;
    return {
      task: taskHeader(task),
      fact: minutes(report.fact),
      agentTime: minutes(report.agentTime),
      userTime: minutes(report.userTime),
      factLow: minutes(report.factLow),
      factHigh: minutes(report.factHigh),
      uncertainty: minutes(report.uncertainty),
      uncertaintyShare: report.uncertaintyShare ?? null,
      uncertaintyExceedsTarget: report.exceedsUncertaintyTarget,
      manualTime: minutes(report.manualTime),
      manualShare: report.manualShare ?? null,
      estimate: estimate?.toData() ?? null,
      // Only the counted fact means anything against the current estimate.
      estimateShare: estimate === undefined || counted.fact.millis === 0 ? null : counted.fact.hours / estimate.likely,
      counted: countedView(counted),
      lost: Math.max(0, minutes(report.fact) - minutes(counted.fact)),
      revisions: revisionViews(task, snapshots),
      agentWork: minutes(report.agentWork),
      calendar: minutes(report.calendar),
      parallel: {
        used: report.parallel.used,
        maxAgents: report.parallel.maxAgents ?? null,
        sequentialEquivalent: report.sequentialEquivalent === undefined ? null : minutes(report.sequentialEquivalent),
      },
      records: { manual: task.manualTime.length, extras: extras.length, extraMinutesByCategory: extraMinutes(extras) },
      plan: plan === undefined ? null : planView(plan),
      planUnavailable: progress.unavailable ?? null,
      untrackedProjects: progress.untracked,
      completedChanges: progress.completed,
      usage: usageView(this.measurement.usage(task, journal)),
    };
  }
}

function taskHeader(task: Task): StatusView['task'] {
  const startedAt = task.startedAt?.toISOString();
  return {
    id: task.id.toString(),
    title: task.title,
    status: task.status,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(task.closure === undefined ? {} : { closedAt: task.closure.at.toISOString() }),
  };
}

function countedView(counted: EffortReport): CountedFact {
  return {
    fact: minutes(counted.fact),
    agentTime: minutes(counted.agentTime),
    userTime: minutes(counted.userTime),
    manualTime: minutes(counted.manualTime),
    factLow: minutes(counted.factLow),
    factHigh: minutes(counted.factHigh),
    uncertainty: minutes(counted.uncertainty),
    agentWork: minutes(counted.agentWork),
    uncertaintyShare: counted.uncertaintyShare ?? null,
    uncertaintyExceedsTarget: counted.exceedsUncertaintyTarget,
    manualShare: counted.manualShare ?? null,
  };
}

/** A revision misses its snapshot when no `plan.revised` names it. */
function revisionViews(task: Task, snapshots: ReadonlySet<string>): RevisionView[] {
  return task.revisions.map((revision) => ({
    at: revision.at.toISOString(),
    lostFrom: revision.lostFrom?.toISOString() ?? null,
    category: revision.category ?? null,
    spent: revision.spent ?? null,
    baseLikelyBefore: revision.baseLikelyBefore ?? null,
    baseLikelyAfter: revision.baseLikelyAfter,
    covers: revision.covers,
    missingSnapshot: !snapshots.has(revision.id),
  }));
}

/** Minutes of timed extra work by category. */
function extraMinutes(extras: readonly Extra[]): Record<string, number> {
  const byCategory: Record<string, number> = {};
  for (const extra of extras) {
    if (extra.time !== undefined) {
      byCategory[extra.category] = (byCategory[extra.category] ?? 0) + minutes(extra.time);
    }
  }
  return byCategory;
}

function planView(plan: PlanProgress): PlanView {
  return {
    done: plan.done,
    mode: plan.mode,
    groupedHours: plan.groupedHours ?? null,
    estimateHours: plan.estimateHours ?? null,
    notStarted: plan.notStarted,
    possibleTypos: plan.possibleTypos,
    archivedBeforeStart: plan.archivedBeforeStart,
    archivedBeforeRevision: plan.archivedBeforeRevision,
  };
}

function minutes(duration: Duration): number {
  return Math.round(duration.minutes);
}

function usageView(usage: TaskUsage | undefined): UsageView | null {
  return usage === undefined ? null : usageSummary(usage);
}
