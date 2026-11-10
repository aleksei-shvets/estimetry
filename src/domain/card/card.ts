import { codeLines, type CodeLines } from '../code/code-volume.js';
import type { LineRange } from '../estimate/code-volume.js';
import type { PartKind, PartPerformer } from '../estimate/part-kind.js';
import type { Estimate } from '../estimate/estimate.js';
import { EXTRA_CATEGORIES, type Extra, type ExtraAccounting, type ExtraCategory } from '../measurement/extra.js';
import type { EffortReport } from '../measurement/effort-report.js';
import type { PartFacts, PartsFactMode } from '../progress/part-facts.js';
import type { CodeMeasured, PlanClosing, ProgressRecord } from '../progress/progress-records.js';
import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';
import type { TaskOutcome } from '../task/task-events.js';
import type { Task } from '../task/task.js';
import type { TokenCounts } from '../progress/session-log.js';
import { usageSummary, type TaskUsage } from '../usage/task-usage.js';

/**
 * 2: the current estimate, revisions and the counted fact beside the first estimate (estimate-revision-cards).
 * 3: bounds of the fact and the tokens and cost of the task (session-log-importer).
 */
export const CARD_SCHEMA_VERSION = 3;

export interface ExtraTally {
  readonly count: number;
  /** How many of them the user put a time on. */
  readonly timed: number;
  readonly minutes: number;
}

/** An estimate as the card keeps it; `type` is the task type it was made for. */
export interface CardEstimate {
  readonly optimisticHours: number;
  readonly likelyHours: number;
  readonly pessimisticHours: number;
  /** Most likely hours before calibration: what the fact is compared with. */
  readonly baseLikelyHours: number;
  readonly calibrated: boolean;
  readonly coefficient?: number;
  readonly codeVolume?: { readonly production?: LineRange; readonly tests?: LineRange };
  readonly type: string;
}

export interface CardPart {
  readonly kind: PartKind;
  readonly who?: PartPerformer;
  readonly likelyHours: number;
  readonly factMinutes: number | null;
  readonly reason?: string;
  /** Whether the changes of the part's group were all completed; null without a group. */
  readonly groupDone: boolean | null;
  /** The only part of its group: its fact says something about its kind. */
  readonly soleInGroup: boolean;
}

export interface CardFact {
  readonly totalMinutes: number;
  readonly agentMinutes: number;
  readonly userMinutes: number;
  readonly manualMinutes: number;
  readonly uncertaintyMinutes: number;
  readonly uncertaintyShare: number | null;
  /** Bounds of the fact; null on a card converted from schema 2 or earlier by its fields. */
  readonly lowMinutes: number | null;
  readonly highMinutes: number | null;
  readonly agentWorkMinutes: number;
}

/** Tokens and cost of the task from the logs of its sessions; never part of calibration. */
export interface CardUsage {
  readonly tokens: Readonly<Record<string, TokenCounts>>;
  readonly costUSD: number | null;
  readonly approximate: boolean;
  /** Sessions with activity in the task, and how many of them have a log. */
  readonly sessions: number;
  readonly withLogs: number;
}

export interface CardRevision {
  readonly at: string;
  readonly lostFrom?: string;
  readonly category?: ExtraCategory;
  readonly spent?: 'include' | 'exclude';
  readonly typeBefore: string;
  readonly typeAfter: string;
  /** Null for a task that had no estimate before. */
  readonly baseLikelyBeforeHours: number | null;
  readonly baseLikelyAfterHours: number;
  /** The counted fact at the moment of the revision: how far into the work it came. */
  readonly countedAtMinutes: number;
  /** Work of its window, measured as the numerator of the main ratio (sequential equivalent in parallel mode). */
  readonly lostMinutes: number;
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
  /** The first estimate, as given at the start: what the main ratio compares the whole fact with. */
  readonly estimate: CardEstimate | null;
  /** The estimate in force at the closing; equal to `estimate` without revisions. */
  readonly currentEstimate: CardEstimate | null;
  readonly revisions: readonly CardRevision[];
  readonly fact: CardFact & {
    /** Without the windows of lost work; equal to the whole fact without revisions with `exclude`. */
    readonly counted: CardFact & { readonly sequentialMinutes: number | null; readonly minimal: boolean };
  };
  readonly accuracy: 'partial' | 'minimal';
  /** The estimate was revised after the start. */
  readonly revised?: boolean;
  /** The task got its estimate only by a revision after the start. */
  readonly estimatedAfterStart?: boolean;
  /** Converted from a card of an older schema without the journal of its task. */
  readonly convertedFrom?: 1 | 2;
  /** Null without session logs. */
  readonly usage: CardUsage | null;
  readonly backgroundAgents: boolean;
  readonly parallel: {
    readonly used: boolean;
    readonly maxAgents: number | null;
    readonly sequentialMinutes: number | null;
    readonly budgetShare: number | null;
    readonly planShare: number | null;
  };
  /** Parts of the first estimate; with revisions their fact is unknown (`revised`). */
  readonly parts: readonly CardPart[];
  /** Parts of the current estimate with their fact; equal to `parts` without revisions. */
  readonly currentParts: readonly CardPart[];
  readonly partsFact: PartsFactMode | 'revised';
  readonly unattributedMinutes: number;
  /** Counted minutes before the last revision. */
  readonly beforeRevisionMinutes: number;
  readonly plan: { readonly done: number | null; readonly unfinishedGroups: number };
  /** Extra work, without what revisions with `exclude` covered. */
  readonly extras: Readonly<Record<ExtraCategory, Readonly<Record<ExtraAccounting, ExtraTally>>>>;
  /** Extra work named in `--covers` of revisions with `exclude`: its loss is in `revisions`. */
  readonly coveredByRevision: Readonly<Record<ExtraCategory, ExtraTally>>;
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
    readonly currentParts: readonly { readonly name: string; readonly group?: string }[];
    readonly revisions: readonly { readonly reason: string }[];
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
  /** The same without the windows of lost work; `report` when absent. */
  readonly counted?: EffortReport;
  /** Fact by parts of the current estimate. */
  readonly partFacts: PartFacts;
  /** Per revision, in their order: counted fact at its moment and the work of its window. */
  readonly revisionFacts?: readonly { readonly countedAtMinutes: number; readonly lostMinutes: number }[];
  readonly records: readonly ProgressRecord[];
  /** Whether the journal has activity from hooks; without it the fact is manual only. */
  readonly hasActivity: boolean;
  readonly usage?: TaskUsage;
}

/** The card of a closed task, built from its journal alone. */
export function buildCard(input: CardInput): Card {
  const { task, report } = input;
  const counted = input.counted ?? report;
  const closure = task.closure;
  const startedAt = task.startedAt;
  if (closure === undefined || startedAt === undefined) {
    throw new InvalidValue(`task ${task.id.toString()} is not closed, so it has no card`);
  }
  const closedAt = Timestamp.parse(closure.at);
  const closing = last<PlanClosing>(input.records, 'plan.closing');
  const measured = last<CodeMeasured>(input.records, 'code.measured');
  const first = task.originalEstimate;
  const current = task.estimate;
  const revised = task.revisions.length > 0;
  const closedMinutes = task.closures
    .filter((c) => c.reopenedAt !== undefined)
    .reduce((sum, c) => sum + (Timestamp.parse(c.reopenedAt as string).toMillis() - Timestamp.parse(c.at).toMillis()) / 60_000, 0);
  const completed = new Set(closing?.data.completedGroups ?? []);
  const firstParallel = task.parallelMode[0]?.change;
  const retro = task.retro;
  const lastReopen = task.closures.map((c) => c.reopenedAt).filter((at): at is string => at !== undefined).at(-1);
  const partIndex = (id: string | undefined) => {
    const index = id === undefined ? -1 : (current?.parts.findIndex((part) => part.id === id) ?? -1);
    return index < 0 ? {} : { part: index };
  };
  const covered = new Set(task.revisions.filter((revision) => revision.spent === 'exclude').flatMap((revision) => revision.covers));
  const minutes = (millis: number) => Math.round(millis / 60_000);
  const cardParts = (estimate: Estimate | undefined, facts: PartFacts | undefined): CardPart[] => {
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
  };
  const factOf = (r: EffortReport): CardFact => ({
    totalMinutes: minutes(r.fact.millis),
    agentMinutes: minutes(r.agentTime.millis),
    userMinutes: minutes(r.userTime.millis),
    manualMinutes: minutes(r.manualTime.millis),
    uncertaintyMinutes: minutes(r.uncertainty.millis),
    uncertaintyShare: r.uncertaintyShare ?? null,
    lowMinutes: minutes(r.factLow.millis),
    highMinutes: minutes(r.factHigh.millis),
    agentWorkMinutes: minutes(r.agentWork.millis),
  });
  const hooksMeasured = (r: EffortReport) => r.measured.agent.total.millis + r.measured.user.total.millis;
  // All activity of hooks inside windows of lost work leaves the counted fact manual only.
  const countedMinimal = !input.hasActivity || (hooksMeasured(report) > 0 && hooksMeasured(counted) === 0);
  const parts = cardParts(current, input.partFacts);

  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    author: task.author,
    task: {
      id: task.id.toString(),
      type: task.type,
      stack: first && first.stack.length > 0 ? [...first.stack] : [...(closing?.data.stack ?? [])],
      ...(task.spawnedFrom === undefined ? {} : { spawnedFrom: task.spawnedFrom }),
      ...(closure.spawned === undefined ? {} : { spawned: closure.spawned }),
    },
    outcome: closure.outcome,
    startedAt: startedAt.toISOString(),
    closedAt: closure.at,
    calendarMinutes: minutes(closedAt.toMillis() - startedAt.toMillis()),
    closedMinutes: Math.round(closedMinutes),
    estimate: cardEstimate(first, task.firstType),
    currentEstimate: cardEstimate(current, task.type),
    revisions: task.revisions.map((revision, i) => ({
      at: revision.at,
      ...(revision.lostFrom === undefined ? {} : { lostFrom: revision.lostFrom }),
      ...(revision.category === undefined ? {} : { category: revision.category }),
      ...(revision.spent === undefined ? {} : { spent: revision.spent }),
      typeBefore: revision.typeBefore ?? task.firstType,
      typeAfter: revision.typeAfter ?? task.type,
      baseLikelyBeforeHours: revision.baseLikelyBefore ?? null,
      baseLikelyAfterHours: revision.baseLikelyAfter,
      countedAtMinutes: input.revisionFacts?.[i]?.countedAtMinutes ?? 0,
      lostMinutes: input.revisionFacts?.[i]?.lostMinutes ?? 0,
    })),
    fact: {
      ...factOf(report),
      counted: {
        ...factOf(counted),
        sequentialMinutes: counted.sequentialEquivalent === undefined ? null : minutes(counted.sequentialEquivalent.millis),
        minimal: countedMinimal,
      },
    },
    accuracy: input.hasActivity ? 'partial' : 'minimal',
    usage: input.usage === undefined ? null : usageSummary(input.usage),
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
    parts: revised ? cardParts(first, undefined) : parts,
    currentParts: parts,
    partsFact: input.partFacts.mode,
    unattributedMinutes: input.partFacts.unattributed,
    beforeRevisionMinutes: input.partFacts.beforeRevision,
    plan: { done: closing?.data.done ?? null, unfinishedGroups: closing?.data.unfinishedGroups.length ?? 0 },
    extras: tallyExtras(task.extraRecords.filter((record) => !covered.has(record.id)).map((record) => record.extra)),
    coveredByRevision: tallyCovered(task.extraRecords.filter((record) => covered.has(record.id)).map((record) => record.extra)),
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
      parts: partNames(first),
      currentParts: partNames(current),
      revisions: task.revisions.map((revision) => ({ reason: revision.reason })),
      unfinishedGroups: [...(closing?.data.unfinishedGroups ?? [])],
      extras: task.extras.map((extra) => ({ category: extra.category, description: extra.description })),
      manual: task.manualTime.map((record) => record.description),
      ...(retro === undefined ? {} : { retro: { reasons: retro.reasons, lesson: retro.lesson } }),
    },
  };
}

function cardEstimate(estimate: Estimate | undefined, type: string): CardEstimate | null {
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

function partNames(estimate: Estimate | undefined): { name: string; group?: string }[] {
  return (estimate?.parts ?? []).map((part) => ({ name: part.name, ...(part.group === undefined ? {} : { group: part.group }) }));
}

/**
 * The last record of a type: measurements are written right before each
 * closing, so the last ones belong to the current closing.
 */
function last<T extends ProgressRecord>(records: readonly ProgressRecord[], type: T['type']): T | undefined {
  return records.filter((record): record is T => record.type === type).at(-1);
}

function tallyExtras(extras: readonly Extra[]): Card['extras'] {
  const absorbed = noExtraTallies();
  const renegotiated = noExtraTallies();
  const result = Object.fromEntries(
    EXTRA_CATEGORIES.map((category) => [category, { absorbed: absorbed[category], renegotiated: renegotiated[category] }]),
  ) as Record<ExtraCategory, Record<ExtraAccounting, ExtraTally>>;
  for (const extra of extras) {
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

/** A tally of no extra work for every category. */
export function noExtraTallies(): Record<ExtraCategory, ExtraTally> {
  return Object.fromEntries(EXTRA_CATEGORIES.map((category) => [category, { count: 0, timed: 0, minutes: 0 }])) as Record<ExtraCategory, ExtraTally>;
}

function tallyCovered(extras: readonly Extra[]): Card['coveredByRevision'] {
  const result = noExtraTallies();
  for (const extra of extras) {
    const tally = result[extra.category];
    result[extra.category] = {
      count: tally.count + 1,
      timed: tally.timed + (extra.time === undefined ? 0 : 1),
      minutes: tally.minutes + (extra.time === undefined ? 0 : Math.round(extra.time.minutes)),
    };
  }
  return result;
}
