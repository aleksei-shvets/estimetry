import type { EffortReport } from '../measurement/effort-report.js';
import type { PartFacts } from '../progress/part-facts.js';
import type { CodeMeasured, PlanClosing, ProgressRecord } from '../progress/progress-records.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { Task } from '../task/task.js';
import { usageSummary, type TaskUsage } from '../usage/task-usage.js';
import { CARD_SCHEMA_VERSION, type Card } from './card.js';
import {
  cardCode,
  cardEstimate,
  cardFact,
  cardParallel,
  cardParts,
  cardRetro,
  cardRevisions,
  cardText,
  closedMinutes,
  minutes,
} from './card-sections.js';
import { tallyCovered, tallyExtras } from './extra-tallies.js';
import type { RevisionFact } from './revision-facts.js';

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
