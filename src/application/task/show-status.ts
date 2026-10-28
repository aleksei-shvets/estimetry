import type { Duration } from '../../domain/measurement/duration.js';
import type { ThreePointData } from '../../domain/estimate/three-point-estimate.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskMeasurement } from './task-measurement.js';

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
}

export class ShowStatus {
  constructor(
    private readonly activeTask: ResolveActiveTask,
    private readonly measurement: TaskMeasurement,
  ) {}

  execute(input: { readonly task?: TaskId }): StatusView {
    const task = this.activeTask.inProgress(input.task);
    const report = this.measurement.measure(task);
    const estimate = task.estimate?.total;
    const extras = task.extras;
    const extraMinutesByCategory: Record<string, number> = {};
    for (const extra of extras) {
      if (extra.time !== undefined) {
        extraMinutesByCategory[extra.category] = (extraMinutesByCategory[extra.category] ?? 0) + minutes(extra.time);
      }
    }
    const startedAt = task.startedAt?.toISOString();
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
    };
  }
}

function minutes(duration: Duration): number {
  return Math.round(duration.minutes);
}
