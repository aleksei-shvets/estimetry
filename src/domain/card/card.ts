import { codeLines, type CodeLines } from '../code/code-volume.js';
import type { LineRange } from '../estimate/code-volume.js';
import type { PartKind, PartPerformer } from '../estimate/part-kind.js';
import { EXTRA_CATEGORIES, type ExtraAccounting, type ExtraCategory } from '../measurement/extra.js';
import type { EffortReport } from '../measurement/effort-report.js';
import type { PartFacts, PartsFactMode } from '../progress/part-facts.js';
import type { CodeMeasured, PlanClosing, ProgressRecord } from '../progress/progress-records.js';
import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';
import type { TaskOutcome } from '../task/task-events.js';
import type { Task } from '../task/task.js';

export const CARD_SCHEMA_VERSION = 1;

export interface ExtraTally {
  readonly count: number;
  /** How many of them the user put a time on. */
  readonly timed: number;
  readonly minutes: number;
}

export type CardRetro =
  | 'pending'
  | { readonly status: 'current' | 'stale'; readonly reasons: readonly { readonly part?: number }[] };

/**
 * What estimating needs of a closed task (task-cards spec): numbers only,
 * with everything that may name a customer or a project in `text` (§12).
 * Durations are minutes, estimate hours sit in `…Hours` fields.
 */
export interface Card {
  readonly schemaVersion: number;
  readonly author: string;
  readonly task: {
    readonly id: string;
    readonly type: string;
    readonly stack: readonly string[];
    readonly spawnedFrom?: string;
    readonly spawned?: string;
  };
  readonly outcome: TaskOutcome;
  readonly startedAt: string;
  readonly closedAt: string;
  readonly calendarMinutes: number;
  /** Minutes the task spent closed before it was reopened. */
  readonly closedMinutes: number;
  readonly estimate: {
    readonly optimisticHours: number;
    readonly likelyHours: number;
    readonly pessimisticHours: number;
    /** Most likely hours before calibration: what the fact is compared with. */
    readonly baseLikelyHours: number;
    readonly calibrated: boolean;
    readonly coefficient?: number;
    readonly codeVolume?: { readonly production?: LineRange; readonly tests?: LineRange };
  } | null;
  readonly fact: {
    readonly totalMinutes: number;
    readonly agentMinutes: number;
    readonly userMinutes: number;
    readonly manualMinutes: number;
    readonly uncertaintyMinutes: number;
    readonly uncertaintyShare: number | null;
    readonly agentWorkMinutes: number;
  };
  readonly accuracy: 'partial' | 'minimal';
  /** The estimate was revised after the start; `estimate` above is the first one. */
  readonly revised?: boolean;
  /** The task got its estimate only by a revision after the start. */
  readonly estimatedAfterStart?: boolean;
  readonly backgroundAgents: boolean;
  readonly parallel: {
    readonly used: boolean;
    readonly maxAgents: number | null;
    readonly sequentialMinutes: number | null;
    readonly budgetShare: number | null;
    readonly planShare: number | null;
  };
  readonly parts: readonly {
    readonly kind: PartKind;
    readonly who?: PartPerformer;
    readonly likelyHours: number;
    readonly factMinutes: number | null;
    readonly reason?: string;
    /** Whether the changes of the part's group were all completed; null without a group. */
    readonly groupDone: boolean | null;
    /** The only part of its group: its fact says something about its kind. */
    readonly soleInGroup: boolean;
  }[];
  readonly partsFact: PartsFactMode | 'revised';
  readonly unattributedMinutes: number;
  readonly plan: { readonly done: number | null; readonly unfinishedGroups: number };
  readonly extras: Readonly<Record<ExtraCategory, Readonly<Record<ExtraAccounting, ExtraTally>>>>;
  readonly code: {
    readonly measuredAt: string;
    /** Git was measured later than the closing moment (`emt close --at`). */
    readonly measuredLater: boolean;
    readonly projects: readonly {
      readonly source: string;
      readonly reason?: string;
      readonly unverified?: boolean;
      readonly unreachable?: number;
      readonly uncovered?: number;
      readonly truncated: boolean;
    }[];
    readonly lines: CodeLines;
  } | null;
  readonly retro: CardRetro;
  readonly text: {
    readonly title: string;
    readonly ticket?: string;
    readonly projects: readonly string[];
    readonly parts: readonly { readonly name: string; readonly group?: string }[];
    readonly unfinishedGroups: readonly string[];
    readonly extras: readonly { readonly category: string; readonly description: string }[];
    readonly manual: readonly string[];
    readonly retro?: { readonly reasons: readonly { readonly text: string; readonly part?: string }[]; readonly lesson: string };
  };
}

export interface CardInput {
  readonly task: Task;
  /** The fact measured up to the closing moment. */
  readonly report: EffortReport;
  readonly partFacts: PartFacts;
  readonly records: readonly ProgressRecord[];
  /** Whether the journal has activity from hooks; without it the fact is manual only. */
  readonly hasActivity: boolean;
}

/** The card of a closed task, built from its journal alone. */
export function buildCard(input: CardInput): Card {
  const { task, report } = input;
  const closure = task.closure;
  const startedAt = task.startedAt;
  if (closure === undefined || startedAt === undefined) {
    throw new InvalidValue(`task ${task.id.toString()} is not closed, so it has no card`);
  }
  const closedAt = Timestamp.parse(closure.at);
  const closing = last<PlanClosing>(input.records, 'plan.closing');
  const measured = last<CodeMeasured>(input.records, 'code.measured');
  // The first estimate: what calibration compares the whole fact with. The revised one comes with card v2.
  const estimate = task.estimatedAfterStart ? task.estimate : task.firstEstimate;
  const revised = task.revisions.length > 0;
  const closedMinutes = task.closures
    .filter((c) => c.reopenedAt !== undefined)
    .reduce((sum, c) => sum + (Timestamp.parse(c.reopenedAt as string).toMillis() - Timestamp.parse(c.at).toMillis()) / 60_000, 0);
  const completed = new Set(closing?.data.completedGroups ?? []);
  const groupSizes = new Map<string, number>();
  for (const part of estimate?.parts ?? []) {
    if (part.group !== undefined) {
      groupSizes.set(part.group, (groupSizes.get(part.group) ?? 0) + 1);
    }
  }
  const firstParallel = task.parallelMode[0]?.change;
  const retro = task.retro;
  const lastReopen = task.closures.map((c) => c.reopenedAt).filter((at): at is string => at !== undefined).at(-1);
  const partIndex = (id: string | undefined) => {
    const index = id === undefined ? -1 : (estimate?.parts.findIndex((part) => part.id === id) ?? -1);
    return index < 0 ? {} : { part: index };
  };
  const extras = tallyExtras(task);
  const minutes = (millis: number) => Math.round(millis / 60_000);

  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    author: task.author,
    task: {
      id: task.id.toString(),
      type: task.type,
      stack: estimate && estimate.stack.length > 0 ? [...estimate.stack] : [...(closing?.data.stack ?? [])],
      ...(task.spawnedFrom === undefined ? {} : { spawnedFrom: task.spawnedFrom }),
      ...(closure.spawned === undefined ? {} : { spawned: closure.spawned }),
    },
    outcome: closure.outcome,
    startedAt: startedAt.toISOString(),
    closedAt: closure.at,
    calendarMinutes: minutes(closedAt.toMillis() - startedAt.toMillis()),
    closedMinutes: Math.round(closedMinutes),
    estimate:
      estimate === undefined
        ? null
        : {
            optimisticHours: estimate.total.optimistic,
            likelyHours: estimate.total.likely,
            pessimisticHours: estimate.total.pessimistic,
            baseLikelyHours: estimate.baseLikely,
            calibrated: estimate.calibrated,
            ...(estimate.coefficient === undefined ? {} : { coefficient: estimate.coefficient }),
            ...(estimate.codeVolume === undefined ? {} : { codeVolume: estimate.codeVolume.toData() }),
          },
    fact: {
      totalMinutes: minutes(report.fact.millis),
      agentMinutes: minutes(report.agentTime.millis),
      userMinutes: minutes(report.userTime.millis),
      manualMinutes: minutes(report.manualTime.millis),
      uncertaintyMinutes: minutes(report.uncertainty.millis),
      uncertaintyShare: report.uncertaintyShare ?? null,
      agentWorkMinutes: minutes(report.agentWork.millis),
    },
    accuracy: input.hasActivity ? 'partial' : 'minimal',
    ...(revised ? { revised: true } : {}),
    ...(task.estimatedAfterStart ? { estimatedAfterStart: true } : {}),
    backgroundAgents: report.backgroundAgents && !report.parallel.used,
    parallel: {
      used: report.parallel.used,
      maxAgents: report.parallel.maxAgents ?? null,
      sequentialMinutes: report.sequentialEquivalent === undefined ? null : minutes(report.sequentialEquivalent.millis),
      budgetShare: firstParallel?.budgetShare ?? null,
      planShare: firstParallel?.planShare ?? null,
    },
    parts: (estimate?.parts ?? []).map((part, i) => {
      const fact = revised ? undefined : input.partFacts.parts[i];
      return {
        kind: part.kind,
        ...(part.who === undefined ? {} : { who: part.who }),
        likelyHours: part.hours.likely,
        factMinutes: fact?.minutes ?? null,
        ...(fact?.reason === undefined ? (revised ? { reason: 'revised' } : {}) : { reason: fact.reason }),
        groupDone: part.group === undefined || closing === undefined ? null : completed.has(part.group),
        soleInGroup: part.group !== undefined && groupSizes.get(part.group) === 1,
      };
    }),
    partsFact: revised ? 'revised' : input.partFacts.mode,
    unattributedMinutes: revised ? Math.round(report.fact.minutes) : input.partFacts.unattributed,
    plan: { done: closing?.data.done ?? null, unfinishedGroups: closing?.data.unfinishedGroups.length ?? 0 },
    extras,
    code:
      measured === undefined
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
          },
    retro:
      retro === undefined
        ? 'pending'
        : {
            status: lastReopen !== undefined && Timestamp.parse(retro.recordedAt).toMillis() < Timestamp.parse(lastReopen).toMillis() ? 'stale' : 'current',
            reasons: retro.reasons.map((reason) => partIndex(reason.part)),
          },
    text: {
      title: task.title,
      ...(task.ticket === undefined ? {} : { ticket: task.ticket }),
      projects: [...task.projects],
      parts: (estimate?.parts ?? []).map((part) => ({ name: part.name, ...(part.group === undefined ? {} : { group: part.group }) })),
      unfinishedGroups: [...(closing?.data.unfinishedGroups ?? [])],
      extras: task.extras.map((extra) => ({ category: extra.category, description: extra.description })),
      manual: task.manualTime.map((record) => record.description),
      ...(retro === undefined ? {} : { retro: { reasons: retro.reasons, lesson: retro.lesson } }),
    },
  };
}

/**
 * The last record of a type: measurements are written right before each
 * closing, so the last ones belong to the current closing.
 */
function last<T extends ProgressRecord>(records: readonly ProgressRecord[], type: T['type']): T | undefined {
  return records.filter((record): record is T => record.type === type).at(-1);
}

function tallyExtras(task: Task): Card['extras'] {
  const empty = (): Record<ExtraAccounting, ExtraTally> => ({
    absorbed: { count: 0, timed: 0, minutes: 0 },
    renegotiated: { count: 0, timed: 0, minutes: 0 },
  });
  const result = Object.fromEntries(EXTRA_CATEGORIES.map((category) => [category, empty()])) as Record<
    ExtraCategory,
    Record<ExtraAccounting, ExtraTally>
  >;
  for (const extra of task.extras) {
    const tally = result[extra.category][extra.accounting];
    const time = extra.time;
    result[extra.category][extra.accounting] = {
      count: tally.count + 1,
      timed: tally.timed + (time === undefined ? 0 : 1),
      minutes: tally.minutes + (time === undefined ? 0 : Math.round(time.minutes)),
    };
  }
  return result;
}
