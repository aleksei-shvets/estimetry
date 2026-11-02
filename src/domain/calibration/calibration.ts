import type { Card } from '../card/card.js';
import { EXTRA_CATEGORIES, type ExtraAccounting, type ExtraCategory } from '../measurement/extra.js';

export const CALIBRATION_SCHEMA_VERSION = 1;
export const DEFAULT_MIN_TASKS = 5;
const UNCERTAINTY_LIMIT = 0.05;

export type Exclusion =
  | 'abandoned'
  | 'zero-fact'
  | 'manual-only'
  | 'renegotiated-without-groups'
  | 'renegotiated-after-revision'
  | 'estimated-after-start';

/** One slice of the ratio fact / estimate. */
export interface RatioStats {
  readonly n: number;
  readonly median: number | null;
  readonly mean: number | null;
  /** Enough tasks to apply the coefficient (§10). */
  readonly applicable: boolean;
  readonly excluded: Readonly<Partial<Record<Exclusion, number>>>;
  readonly uncertain: number;
  readonly backgroundAgents: number;
}

export interface ShareStats {
  readonly n: number;
  readonly median: number | null;
}

export interface AuthorCalibration {
  readonly tasks: number;
  readonly ratio: {
    readonly overall: RatioStats;
    readonly byType: Readonly<Record<string, RatioStats>>;
    readonly byStack: Readonly<Record<string, RatioStats>>;
  };
  /** By type, category and accounting: minutes of extra work per estimated minute. */
  readonly extras: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<ExtraAccounting, { readonly share: number; readonly count: number; readonly timed: number }>>>>>
  >;
  /** By type: the spawned task's estimate over the original one. */
  readonly missedScope: Readonly<Record<string, ShareStats>>;
  readonly codeVolume: Readonly<Record<'production' | 'tests', { readonly within: number; readonly below: number; readonly above: number; readonly median: number | null }>>;
  readonly linesPerHour: Readonly<Record<string, ShareStats>>;
  readonly parts: Readonly<Record<string, ShareStats>>;
}

export interface Calibration {
  readonly schemaVersion: number;
  readonly minTasks: number;
  readonly authors: Readonly<Record<string, AuthorCalibration>>;
}

interface Sample {
  readonly card: Card;
  readonly ratio: number;
}

/** Calibration from the cards of closed tasks, by author (design §10, calibration spec). */
export function calibrate(cards: readonly Card[], options: { readonly minTasks?: number } = {}): Calibration {
  const minTasks = options.minTasks ?? DEFAULT_MIN_TASKS;
  const authors: Record<string, AuthorCalibration> = {};
  const byId = new Map(cards.map((card) => [card.task.id, card]));
  for (const author of [...new Set(cards.map((card) => card.author))].sort()) {
    authors[author] = forAuthor(cards.filter((card) => card.author === author), byId, minTasks);
  }
  return { schemaVersion: CALIBRATION_SCHEMA_VERSION, minTasks, authors };
}

function forAuthor(cards: readonly Card[], byId: ReadonlyMap<string, Card>, minTasks: number): AuthorCalibration {
  const estimated = cards.filter((card) => card.estimate !== null);
  const samples: Sample[] = [];
  const excluded: { card: Card; reason: Exclusion }[] = [];
  for (const card of estimated) {
    const reason = exclusion(card);
    if (reason !== undefined) {
      excluded.push({ card, reason });
      continue;
    }
    const ratio = ratioOf(card);
    if (ratio === undefined) {
      excluded.push({ card, reason: 'renegotiated-without-groups' });
    } else {
      samples.push({ card, ratio });
    }
  }
  const slice = (keep: (card: Card) => boolean): RatioStats =>
    ratioStats(
      samples.filter((sample) => keep(sample.card)),
      excluded.filter((item) => keep(item.card)).map((item) => item.reason),
      minTasks,
    );
  const types = [...new Set(estimated.map((card) => card.task.type))].sort();
  const stacks = [...new Set(estimated.flatMap((card) => card.task.stack))].sort();
  return {
    tasks: cards.length,
    ratio: {
      overall: slice(() => true),
      byType: Object.fromEntries(types.map((type) => [type, slice((card) => card.task.type === type)])),
      byStack: Object.fromEntries(stacks.map((tech) => [tech, slice((card) => card.task.stack.includes(tech))])),
    },
    extras: extrasByType(samples.map((sample) => sample.card)),
    missedScope: missedScope(samples.map((sample) => sample.card), byId),
    codeVolume: {
      production: volumeAccuracy(samples.map((s) => s.card), 'production'),
      tests: volumeAccuracy(samples.map((s) => s.card), 'tests'),
    },
    linesPerHour: linesPerHour(samples.map((sample) => sample.card)),
    parts: partsByKind(samples.map((sample) => sample.card)),
  };
}

function exclusion(card: Card): Exclusion | undefined {
  if (card.outcome === 'abandoned') {
    return 'abandoned';
  }
  if (card.estimatedAfterStart) {
    return 'estimated-after-start';
  }
  // The completed parts of the first estimate are not known once the plan was revised.
  if (card.outcome === 'renegotiated' && card.revised) {
    return 'renegotiated-after-revision';
  }
  if (card.fact.totalMinutes === 0) {
    return 'zero-fact';
  }
  if (card.accuracy === 'minimal') {
    return 'manual-only';
  }
  return undefined;
}

/**
 * Fact over the estimate before calibration. A parallel task counts with its
 * sequential equivalent; a renegotiated original only against the parts it did.
 */
function ratioOf(card: Card): number | undefined {
  const estimate = card.estimate;
  if (estimate === null) {
    return undefined;
  }
  const minutes = card.parallel.used && card.parallel.sequentialMinutes !== null ? card.parallel.sequentialMinutes : card.fact.totalMinutes;
  let base = estimate.baseLikelyHours;
  if (card.outcome === 'renegotiated') {
    const done = card.parts.filter((part) => part.groupDone === true);
    if (done.length === 0) {
      return undefined;
    }
    const coefficient = estimate.coefficient ?? 1;
    base = done.reduce((sum, part) => sum + part.likelyHours, 0) / coefficient;
  }
  return base > 0 ? minutes / 60 / base : undefined;
}

function ratioStats(samples: readonly Sample[], reasons: readonly Exclusion[], minTasks: number): RatioStats {
  const ratios = samples.map((sample) => sample.ratio);
  const excluded: Partial<Record<Exclusion, number>> = {};
  for (const reason of reasons) {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  }
  return {
    n: ratios.length,
    median: median(ratios),
    mean: ratios.length === 0 ? null : round(ratios.reduce((a, b) => a + b, 0) / ratios.length),
    applicable: ratios.length >= minTasks,
    excluded,
    uncertain: samples.filter((sample) => (sample.card.fact.uncertaintyShare ?? 0) > UNCERTAINTY_LIMIT).length,
    backgroundAgents: samples.filter((sample) => sample.card.backgroundAgents).length,
  };
}

function extrasByType(cards: readonly Card[]): AuthorCalibration['extras'] {
  const result: Record<string, Record<string, Record<ExtraAccounting, { share: number; count: number; timed: number }>>> = {};
  for (const type of [...new Set(cards.map((card) => card.task.type))].sort()) {
    const ofType = cards.filter((card) => card.task.type === type);
    const baseMinutes = ofType.reduce((sum, card) => sum + (card.estimate?.baseLikelyHours ?? 0) * 60, 0);
    const categories: Record<string, Record<ExtraAccounting, { share: number; count: number; timed: number }>> = {};
    for (const category of EXTRA_CATEGORIES) {
      const tally = (accounting: ExtraAccounting) => {
        const items = ofType.map((card) => card.extras[category as ExtraCategory][accounting]);
        const minutes = items.reduce((sum, item) => sum + item.minutes, 0);
        return {
          share: baseMinutes === 0 ? 0 : round(minutes / baseMinutes),
          count: items.reduce((sum, item) => sum + item.count, 0),
          timed: items.reduce((sum, item) => sum + item.timed, 0),
        };
      };
      categories[category] = { absorbed: tally('absorbed'), renegotiated: tally('renegotiated') };
    }
    result[type] = categories;
  }
  return result;
}

function missedScope(cards: readonly Card[], byId: ReadonlyMap<string, Card>): AuthorCalibration['missedScope'] {
  const shares = new Map<string, number[]>();
  for (const card of cards) {
    const spawned = card.task.spawned === undefined ? undefined : byId.get(card.task.spawned);
    if (card.estimate === null || spawned?.estimate == null || card.estimate.baseLikelyHours === 0) {
      continue;
    }
    const list = shares.get(card.task.type) ?? [];
    list.push(spawned.estimate.baseLikelyHours / card.estimate.baseLikelyHours);
    shares.set(card.task.type, list);
  }
  return Object.fromEntries([...shares].sort().map(([type, values]) => [type, { n: values.length, median: median(values) }]));
}

function volumeAccuracy(cards: readonly Card[], kind: 'production' | 'tests'): AuthorCalibration['codeVolume']['production'] {
  let within = 0;
  let below = 0;
  let above = 0;
  const ratios: number[] = [];
  for (const card of cards) {
    const range = card.estimate?.codeVolume?.[kind];
    const lines = card.code?.lines[kind];
    if (range === undefined || lines === undefined || card.code?.projects.some((p) => p.source === 'unknown')) {
      continue;
    }
    const [min, max] = range;
    if (lines.added < min) {
      below += 1;
    } else if (lines.added > max) {
      above += 1;
    } else {
      within += 1;
    }
    const middle = (min + max) / 2;
    if (middle > 0) {
      ratios.push(lines.added / middle);
    }
  }
  return { within, below, above, median: median(ratios) };
}

function linesPerHour(cards: readonly Card[]): AuthorCalibration['linesPerHour'] {
  const values = new Map<string, number[]>();
  for (const card of cards) {
    if (card.code === null || card.fact.totalMinutes === 0) {
      continue;
    }
    const lines = card.code.lines.production.added + card.code.lines.tests.added;
    for (const tech of card.task.stack) {
      const list = values.get(tech) ?? [];
      list.push(lines / (card.fact.totalMinutes / 60));
      values.set(tech, list);
    }
  }
  return Object.fromEntries([...values].sort().map(([tech, list]) => [tech, { n: list.length, median: median(list) }]));
}

/** Only parts alone in their group: the time of a shared group says nothing about one kind. */
function partsByKind(cards: readonly Card[]): AuthorCalibration['parts'] {
  const values = new Map<string, number[]>();
  for (const card of cards) {
    if (card.partsFact !== 'by-checkboxes') {
      continue;
    }
    const coefficient = card.estimate?.coefficient ?? 1;
    for (const part of card.parts) {
      if (!part.soleInGroup || part.factMinutes === null || part.likelyHours === 0) {
        continue;
      }
      const list = values.get(part.kind) ?? [];
      list.push(part.factMinutes / 60 / (part.likelyHours / coefficient));
      values.set(part.kind, list);
    }
  }
  return Object.fromEntries([...values].sort().map(([kind, list]) => [kind, { n: list.length, median: median(list) }]));
}

/** The middle value; with an even count, the mean of the two middle ones. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return round(value);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
