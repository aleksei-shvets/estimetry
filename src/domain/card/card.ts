import type { CodeLines } from '../code/code-volume.js';
import type { LineRange } from '../estimate/code-volume.js';
import type { PartKind, PartPerformer } from '../estimate/part-kind.js';
import type { ExtraAccounting, ExtraCategory } from '../measurement/extra.js';
import type { EffortReport } from '../measurement/effort-report.js';
import type { PartFacts, PartsFactMode } from '../progress/part-facts.js';
import type { CodeMeasured, PlanClosing, ProgressRecord } from '../progress/progress-records.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { TaskOutcome } from '../task/task-events.js';
import type { Task } from '../task/task.js';
import { cardCode, cardEstimate, cardFact, cardParallel, cardParts, cardRetro, cardRevisions, cardText, closedMinutes, minutes } from './card-sections.js';
import { tallyCovered, tallyExtras } from './extra-tallies.js';
import type { RevisionFact } from './revision-facts.js';
import type { TokenCounts } from '../progress/session-log.js';
import { usageSummary, type TaskUsage } from '../usage/task-usage.js';

export { noExtraTallies } from './extra-tallies.js';

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
  readonly revisionFacts?: readonly RevisionFact[];
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
  const closedAt = closure.at;
  const closing = last<PlanClosing>(input.records, 'plan.closing');
  const first = task.originalEstimate;
  const current = task.estimate;
  const revised = task.revisions.length > 0;
  const covered = new Set(task.revisions.filter((revision) => revision.spent === 'exclude').flatMap((revision) => revision.covers));
  const isCovered = (id: string | undefined) => id !== undefined && covered.has(id);
  const parts = cardParts(current, input.partFacts, closing);
  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    author: task.author.id,
    task: {
      id: task.id.toString(),
      type: task.type.value,
      stack: first && first.stack.length > 0 ? [...first.stack] : [...(closing?.data.stack ?? [])],
      ...(task.spawnedFrom === undefined ? {} : { spawnedFrom: task.spawnedFrom.toString() }),
      ...(closure.spawned === undefined ? {} : { spawned: closure.spawned.toString() }),
    },
    outcome: closure.outcome,
    startedAt: startedAt.toISOString(),
    closedAt: closure.at.toISOString(),
    calendarMinutes: minutes(closedAt.toMillis() - startedAt.toMillis()),
    closedMinutes: Math.round(closedMinutes(task)),
    estimate: cardEstimate(first, task.firstType.value),
    currentEstimate: cardEstimate(current, task.type.value),
    revisions: cardRevisions(task, input.revisionFacts),
    fact: cardFact(report, counted, input.hasActivity),
    accuracy: input.hasActivity ? 'partial' : 'minimal',
    usage: input.usage === undefined ? null : usageSummary(input.usage),
    ...(revised ? { revised: true } : {}),
    ...(task.estimatedAfterStart ? { estimatedAfterStart: true } : {}),
    backgroundAgents: report.backgroundAgents && !report.parallel.used,
    parallel: cardParallel(report, task.parallelMode[0]?.change),
    parts: revised ? cardParts(first, undefined, closing) : parts,
    currentParts: parts,
    partsFact: input.partFacts.mode,
    unattributedMinutes: input.partFacts.unattributed,
    beforeRevisionMinutes: input.partFacts.beforeRevision,
    plan: { done: closing?.data.done ?? null, unfinishedGroups: closing?.data.unfinishedGroups.length ?? 0 },
    extras: tallyExtras(task.extraRecords.filter((record) => !isCovered(record.id)).map((record) => record.extra)),
    coveredByRevision: tallyCovered(task.extraRecords.filter((record) => isCovered(record.id)).map((record) => record.extra)),
    code: cardCode(last<CodeMeasured>(input.records, 'code.measured'), closedAt),
    retro: cardRetro(task),
    text: cardText(task, closing),
  };
}

/**
 * The last record of a type: measurements are written right before each
 * closing, so the last ones belong to the current closing.
 */
function last<T extends ProgressRecord>(records: readonly ProgressRecord[], type: T['type']): T | undefined {
  return records.filter((record): record is T => record.type === type).at(-1);
}
