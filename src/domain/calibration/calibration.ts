import type { Card } from '../card/card.js';
import { stackLabels } from '../estimate/stack-labels.js';
import { exclusion, ratioOf, revisedExclusion, revisedRatioOf, type Exclusion } from './task-ratio.js';
import { EXTRA_CATEGORIES, type ExtraAccounting, type ExtraCategory } from '../measurement/extra.js';
import {
  isRevised,
  linesPerHour,
  partsByKind,
  volumeAccuracy,
  type PartsStats,
  type ShareStats,
  type VolumeStats,
} from './code-and-parts.js';
import { median, round } from './statistics.js';

export type { Exclusion } from './task-ratio.js';

/** 2: the sections of revised tasks and revisions (estimate-revision-cards); readers check the version. */
export const CALIBRATION_SCHEMA_VERSION = 2;
export const DEFAULT_MIN_TASKS = 5;
const UNCERTAINTY_LIMIT = 0.05;

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
  /** Tasks of the slice whose estimate was revised. */
  readonly revised: number;
}

export interface RatioSlices<T extends RatioStats = RatioStats> {
  readonly overall: T;
  readonly byType: Readonly<Record<string, T>>;
  readonly byStack: Readonly<Record<string, T>>;
}

/** The ratio of revised tasks, with how far into the work the last revision came. */
export interface RevisedStats extends RatioStats {
  /** Median of the counted fact at the last revision over the whole counted fact. */
  readonly countedAtShare: number | null;
}

export interface RevisionStats {
  readonly n: number;
  /** Median of the base after over the base before. */
  readonly growth: number | null;
  /** With `exclude`: median of the lost work over the base of the first estimate. */
  readonly lostShare: number | null;
}

export interface AuthorCalibration {
  readonly tasks: number;
  /** Whole fact over the first estimate, by the type of the first estimate. */
  readonly ratio: RatioSlices;
  /** Counted fact over the current estimate of revised tasks, by its type. */
  readonly revised: RatioSlices<RevisedStats>;
  /** By the type before the revision, category and `spent`. */
  readonly revisions: {
    readonly byType: Readonly<Record<string, Readonly<Record<string, Readonly<Partial<Record<'include' | 'exclude', RevisionStats>>>>>>>;
    readonly excluded: Readonly<Partial<Record<Exclusion, number>>>;
  };
  /** By type, category and accounting: minutes of extra work per estimated minute. */
  readonly extras: Readonly<
    Record<
      string,
      Readonly<
        Record<string, Readonly<Record<ExtraAccounting, { readonly share: number; readonly count: number; readonly timed: number }>>>
      >
    >
  >;
  /** By type: the spawned task's estimate over the original one. */
  readonly missedScope: Readonly<Record<string, ShareStats>>;
  readonly codeVolume: { readonly production: VolumeStats; readonly tests: VolumeStats; readonly excluded: number };
  readonly linesPerHour: { readonly byStack: Readonly<Record<string, ShareStats>>; readonly excluded: number };
  readonly parts: PartsStats;
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
export function calibrate(
  all: readonly Card[],
  options: { readonly minTasks?: number; readonly aliases?: ReadonlyMap<string, string> } = {},
): Calibration {
  const minTasks = options.minTasks ?? DEFAULT_MIN_TASKS;
  const cards = normalized(all, options.aliases);
  const authors: Record<string, AuthorCalibration> = {};
  const byId = new Map(cards.map((card) => [card.task.id, card]));
  for (const author of [...new Set(cards.map((card) => card.author))].sort()) {
    authors[author] = forAuthor(cards.filter((card) => card.author === author), byId, minTasks);
  }
  return { schemaVersion: CALIBRATION_SCHEMA_VERSION, minTasks, authors };
}

/**
 * Cards as calibration compares them: a card of an alias is the author's
 * (`author.aliases`), stack labels in lower case. The cards themselves stay as written.
 */
export function normalized(cards: readonly Card[], aliases: ReadonlyMap<string, string> = new Map()): Card[] {
  return cards.map((card) => ({
    ...card,
    author: aliases.get(card.author) ?? card.author,
    task: { ...card.task, stack: stackLabels(card.task.stack) },
  }));
}

function forAuthor(cards: readonly Card[], byId: ReadonlyMap<string, Card>, minTasks: number): AuthorCalibration {
  const estimated = cards.filter((card) => card.estimate !== null);
  const main = sampled(estimated, exclusion, ratioOf);
  const revisedCards = estimated.filter(isRevised);
  const later = sampled(revisedCards, revisedExclusion, revisedRatioOf);
  const kept = main.samples.map((sample) => sample.card);
  // Rolled back work leaves lines that say nothing about the volume of the task.
  const volumeCards = kept.filter((card) => !hasExclude(card) && !(card.convertedFrom === 1 && card.revised));
  const volumeExcluded = kept.length - volumeCards.length;
  return {
    tasks: cards.length,
    ratio: slices(main, (card) => card.estimate?.type, (samples, reasons) => ratioStats(samples, reasons, minTasks)),
    revised: slices(later, (card) => card.currentEstimate?.type, (samples, reasons) => ({
      ...ratioStats(samples, reasons, minTasks, (card) => card.fact.counted.uncertaintyShare),
      countedAtShare: median(
        samples.flatMap(({ card }) => {
          const at = card.revisions.at(-1)?.countedAtMinutes;
          return at === undefined || card.fact.counted.totalMinutes === 0 ? [] : [at / card.fact.counted.totalMinutes];
        }),
      ),
    })),
    revisions: revisionStats(estimated),
    extras: extrasByType(kept),
    missedScope: missedScope(estimated.filter((card) => card.outcome !== 'abandoned'), byId),
    codeVolume: {
      production: volumeAccuracy(volumeCards, 'production'),
      tests: volumeAccuracy(volumeCards, 'tests'),
      excluded: volumeExcluded,
    },
    linesPerHour: { byStack: linesPerHour(volumeCards), excluded: volumeExcluded },
    parts: partsByKind(kept),
  };
}

function hasExclude(card: Card): boolean {
  return card.revisions.some((revision) => revision.spent === 'exclude');
}

interface Sampled {
  readonly samples: readonly Sample[];
  readonly excluded: readonly { readonly card: Card; readonly reason: Exclusion }[];
}

function sampled(
  cards: readonly Card[],
  exclude: (card: Card) => Exclusion | undefined,
  ratio: (card: Card) => number | undefined,
): Sampled {
  const samples: Sample[] = [];
  const excluded: { card: Card; reason: Exclusion }[] = [];
  for (const card of cards) {
    const reason = exclude(card);
    if (reason !== undefined) {
      excluded.push({ card, reason });
      continue;
    }
    const value = ratio(card);
    if (value === undefined) {
      excluded.push({ card, reason: 'renegotiated-without-groups' });
    } else {
      samples.push({ card, ratio: value });
    }
  }
  return { samples, excluded };
}

/** Overall, by type and by each technology of the stack. */
function slices<T>(
  sampled: Sampled,
  typeOf: (card: Card) => string | undefined,
  stats: (samples: readonly Sample[], reasons: readonly Exclusion[]) => T,
): { overall: T; byType: Record<string, T>; byStack: Record<string, T> } {
  const all = [...sampled.samples.map((s) => s.card), ...sampled.excluded.map((e) => e.card)];
  const slice = (keep: (card: Card) => boolean): T =>
    stats(
      sampled.samples.filter((sample) => keep(sample.card)),
      sampled.excluded.filter((item) => keep(item.card)).map((item) => item.reason),
    );
  const types = [...new Set(all.flatMap((card) => typeOf(card) ?? []))].sort();
  const stacks = [...new Set(all.flatMap((card) => card.task.stack))].sort();
  return {
    overall: slice(() => true),
    byType: Object.fromEntries(types.map((type) => [type, slice((card) => typeOf(card) === type)])),
    byStack: Object.fromEntries(stacks.map((tech) => [tech, slice((card) => card.task.stack.includes(tech))])),
  };
}

function revisionStats(cards: readonly Card[]): AuthorCalibration['revisions'] {
  const groups = new Map<string, { growth: number[]; lost: number[]; n: number }>();
  let fromV1 = 0;
  for (const card of cards) {
    if (card.convertedFrom === 1 && card.revised) {
      fromV1 += 1;
      continue;
    }
    for (const revision of card.revisions) {
      if (revision.spent === undefined) {
        continue;
      }
      const key = [revision.typeBefore, revision.category ?? 'none', revision.spent].join('\u0000');
      const group = groups.get(key) ?? { growth: [], lost: [], n: 0 };
      group.n += 1;
      const before = revision.baseLikelyBeforeHours;
      if (before !== null && before > 0) {
        group.growth.push(revision.baseLikelyAfterHours / before);
      }
      const base = card.estimate?.baseLikelyHours ?? before;
      if (revision.spent === 'exclude' && base !== null && base !== undefined && base > 0) {
        group.lost.push(revision.lostMinutes / 60 / base);
      }
      groups.set(key, group);
    }
  }
  const byType: Record<string, Record<string, Partial<Record<'include' | 'exclude', RevisionStats>>>> = {};
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [type, category, spent] = key.split('\u0000') as [string, string, 'include' | 'exclude'];
    const ofType = (byType[type] ??= {});
    const ofCategory = (ofType[category] ??= {});
    ofCategory[spent] = { n: group.n, growth: median(group.growth), lostShare: spent === 'exclude' ? median(group.lost) : null };
  }
  return { byType, excluded: fromV1 === 0 ? {} : { 'card-v1': fromV1 } };
}

function ratioStats(
  samples: readonly Sample[],
  reasons: readonly Exclusion[],
  minTasks: number,
  uncertaintyOf: (card: Card) => number | null = (card) => card.fact.uncertaintyShare,
): RatioStats {
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
    uncertain: samples.filter((sample) => (uncertaintyOf(sample.card) ?? 0) > UNCERTAINTY_LIMIT).length,
    backgroundAgents: samples.filter((sample) => sample.card.backgroundAgents).length,
    revised: samples.filter((sample) => isRevised(sample.card)).length,
  };
}

function extrasByType(cards: readonly Card[]): AuthorCalibration['extras'] {
  const result: Record<string, Record<string, Record<ExtraAccounting, { share: number; count: number; timed: number }>>> = {};
  for (const type of [...new Set(cards.flatMap((card) => card.estimate?.type ?? []))].sort()) {
    const ofType = cards.filter((card) => card.estimate?.type === type);
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
    const list = shares.get(card.estimate.type) ?? [];
    list.push(spawned.estimate.baseLikelyHours / card.estimate.baseLikelyHours);
    shares.set(card.estimate.type, list);
  }
  return Object.fromEntries([...shares].sort().map(([type, values]) => [type, { n: values.length, median: median(values) }]));
}
