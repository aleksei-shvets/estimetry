import { codeLines } from '../code/code-volume.js';
import type { Estimate } from '../estimate/estimate.js';
import type { EffortReport } from '../measurement/effort-report.js';
import type { ParallelModeChangeData } from '../measurement/parallel-mode.js';
import type { PartFacts } from '../progress/part-facts.js';
import type { CodeMeasured, PlanClosing } from '../progress/progress-records.js';
import { Timestamp } from '../shared/timestamp.js';
import type { Task } from '../task/task.js';
import type { Card, CardEstimate, CardFact, CardPart } from './card.js';
import type { RevisionFact } from './revision-facts.js';

/*
 * Sections of the card of a closed task (task-cards spec), each from the task
 * and its measurements alone. Keys keep the order the card file has always had.
 */

export function minutes(millis: number): number {
  return Math.round(millis / 60_000);
}

/** Minutes the task spent closed between a closing and its reopening. */
export function closedMinutes(task: Task): number {
  return task.closures.reduce((sum, c) => sum + (c.reopenedAt === undefined ? 0 : c.reopenedAt.toMillis() - c.at.toMillis()) / 60_000, 0);
}

export function cardEstimate(estimate: Estimate | undefined, type: string): CardEstimate | null {
  return estimate === undefined
    ? null
    : {
        optimisticHours: estimate.total.optimistic,
        likelyHours: estimate.total.likely,
        pessimisticHours: estimate.total.pessimistic,
        baseLikelyHours: estimate.baseLikely,
        calibrated: estimate.calibrated,
        ...(estimate.coefficient === undefined ? {} : { coefficient: estimate.coefficient }),
        ...(estimate.codeVolume === undefined ? {} : { codeVolume: estimate.codeVolume.toData() }),
        type,
      };
}

/** Parts of an estimate with their fact; a group is done when the closing plan says so. */
export function cardParts(estimate: Estimate | undefined, facts: PartFacts | undefined, closing: PlanClosing | undefined): CardPart[] {
  const completed = new Set(closing?.data.completedGroups ?? []);
  const sizes = new Map<string, number>();
  for (const part of estimate?.parts ?? []) {
    if (part.group !== undefined) {
      sizes.set(part.group, (sizes.get(part.group) ?? 0) + 1);
    }
  }
  return (estimate?.parts ?? []).map((part, i) => {
    const fact = facts?.parts[i];
    return {
      kind: part.kind,
      ...(part.who === undefined ? {} : { who: part.who }),
      likelyHours: part.hours.likely,
      factMinutes: fact?.minutes ?? null,
      ...(fact === undefined ? { reason: 'revised' } : fact.reason === undefined ? {} : { reason: fact.reason }),
      groupDone: part.group === undefined || closing === undefined ? null : completed.has(part.group),
      soleInGroup: part.group !== undefined && sizes.get(part.group) === 1,
    };
  });
}

function factOf(r: EffortReport): CardFact {
  return {
    totalMinutes: minutes(r.fact.millis),
    agentMinutes: minutes(r.agentTime.millis),
    userMinutes: minutes(r.userTime.millis),
    manualMinutes: minutes(r.manualTime.millis),
    uncertaintyMinutes: minutes(r.uncertainty.millis),
    uncertaintyShare: r.uncertaintyShare ?? null,
    lowMinutes: minutes(r.factLow.millis),
    highMinutes: minutes(r.factHigh.millis),
    agentWorkMinutes: minutes(r.agentWork.millis),
  };
}

/** The fact and the counted fact; all activity of hooks inside windows of lost work leaves the counted fact manual only. */
export function cardFact(report: EffortReport, counted: EffortReport, hasActivity: boolean): Card['fact'] {
  const hooksMeasured = (r: EffortReport) => r.measured.agent.total.millis + r.measured.user.total.millis;
  const countedMinimal = !hasActivity || (hooksMeasured(report) > 0 && hooksMeasured(counted) === 0);
  return {
    ...factOf(report),
    counted: {
      ...factOf(counted),
      sequentialMinutes: counted.sequentialEquivalent === undefined ? null : minutes(counted.sequentialEquivalent.millis),
      minimal: countedMinimal,
    },
  };
}

export function cardRevisions(task: Task, facts: readonly RevisionFact[] | undefined): Card['revisions'] {
  return task.revisions.map((revision, i) => ({
    at: revision.at.toISOString(),
    ...(revision.lostFrom === undefined ? {} : { lostFrom: revision.lostFrom.toISOString() }),
    ...(revision.category === undefined ? {} : { category: revision.category }),
    ...(revision.spent === undefined ? {} : { spent: revision.spent }),
    typeBefore: (revision.typeBefore ?? task.firstType).value,
    typeAfter: (revision.typeAfter ?? task.type).value,
    baseLikelyBeforeHours: revision.baseLikelyBefore ?? null,
    baseLikelyAfterHours: revision.baseLikelyAfter,
    ...(facts?.[i] ?? { countedAtMinutes: 0, lostMinutes: 0 }),
  }));
}

/** Parallel mode as the card keeps it; budget and plan shares are those of its first period. */
export function cardParallel(report: EffortReport, firstPeriod: ParallelModeChangeData | undefined): Card['parallel'] {
  return {
    used: report.parallel.used,
    maxAgents: report.parallel.maxAgents ?? null,
    sequentialMinutes: report.sequentialEquivalent === undefined ? null : minutes(report.sequentialEquivalent.millis),
    budgetShare: firstPeriod?.budgetShare ?? null,
    planShare: firstPeriod?.planShare ?? null,
  };
}

/** The code volume measured at the closing; measured later means over a minute after the closing moment. */
export function cardCode(measured: CodeMeasured | undefined, closedAt: Timestamp): Card['code'] {
  return measured === undefined
    ? null
    : {
        measuredAt: measured.data.measuredAt,
        measuredLater: Timestamp.parse(measured.data.measuredAt).toMillis() - closedAt.toMillis() > 60_000,
        projects: measured.data.projects.map((project) => ({
          source: project.source,
          ...(project.reason === undefined ? {} : { reason: project.reason }),
          ...(project.unverified ? { unverified: true } : {}),
          ...(project.unreachable === undefined ? {} : { unreachable: project.unreachable }),
          ...(project.uncovered === undefined ? {} : { uncovered: project.uncovered }),
          truncated: project.truncated,
        })),
        lines: codeLines(measured.data.projects),
      };
}

/** The retro is stale when it was recorded before the last reopening; its reasons point at parts of the current estimate. */
export function cardRetro(task: Task): Card['retro'] {
  const retro = task.retro;
  if (retro === undefined) {
    return 'pending';
  }
  const lastReopen = task.closures.flatMap((c) => (c.reopenedAt === undefined ? [] : [c.reopenedAt])).at(-1);
  const partIndex = (id: string | undefined) => {
    const index = id === undefined ? -1 : (task.estimate?.parts.findIndex((part) => part.id === id) ?? -1);
    return index < 0 ? {} : { part: index };
  };
  return {
    status: lastReopen !== undefined && retro.recordedAt.toMillis() < lastReopen.toMillis() ? 'stale' : 'current',
    reasons: retro.reasons.map((reason) => partIndex(reason.part)),
  };
}

/** What the user wrote, kept apart from the numbers so that a card can be shared without it. */
export function cardText(task: Task, closing: PlanClosing | undefined): Card['text'] {
  const retro = task.retro;
  return {
    title: task.title,
    ...(task.ticket === undefined ? {} : { ticket: task.ticket }),
    projects: task.projects.map((project) => project.value),
    parts: partNames(task.originalEstimate),
    currentParts: partNames(task.estimate),
    revisions: task.revisions.map((revision) => ({ reason: revision.reason })),
    unfinishedGroups: [...(closing?.data.unfinishedGroups ?? [])],
    extras: task.extras.map((extra) => ({ category: extra.category, description: extra.description })),
    manual: task.manualTime.map((record) => record.description),
    ...(retro === undefined ? {} : { retro: { reasons: retro.reasons, lesson: retro.lesson } }),
  };
}

function partNames(estimate: Estimate | undefined): { name: string; group?: string }[] {
  return (estimate?.parts ?? []).map((part) => ({ name: part.name, ...(part.group === undefined ? {} : { group: part.group }) }));
}
