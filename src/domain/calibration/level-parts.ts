import type { Card } from '../card/card.js';
import type { EstimateQuery } from '../card/estimate-query.js';
import type { CalibrationPolicy } from './calibration-policy.js';
import type { RatioSample, RatioSampling } from './ratio-samples.js';

export type CoefficientSlice = { readonly kind: 'overall' } | { readonly kind: 'type' | 'stack'; readonly key: string };

/** A level of the chain with its own tasks: those no deeper level holds. */
export interface LevelPart {
  readonly slice: CoefficientSlice;
  /** Ratios of the own tasks of the level. */
  readonly ratios: readonly number[];
}

interface Level {
  readonly slice: CoefficientSlice;
  readonly samples: readonly RatioSample[];
}

/**
 * The levels of the coefficient, from overall to the deepest, each with the
 * tasks it alone counts (calibration-query spec). A level counts when its whole
 * slice has a weight above 0; the overall slice, the technology of the query
 * with the most tasks (the first alphabetically on a tie), the type of the
 * query. The deepest level takes all of its tasks, each level above only those
 * no deeper level holds: every task counts once. Without a weight in the
 * overall slice there are no levels.
 */
export function levelParts(sampling: RatioSampling, query: EstimateQuery, policy: CalibrationPolicy): LevelPart[] {
  const levels = levelsOf(sampling, query, policy);
  const deeper = new Set<Card>();
  const parts: LevelPart[] = [];
  for (const level of [...levels].reverse()) {
    const own = level.samples.filter((sample) => !deeper.has(sample.card));
    own.forEach((sample) => deeper.add(sample.card));
    parts.unshift({ slice: level.slice, ratios: own.map((sample) => sample.ratio) });
  }
  return parts;
}

function levelsOf(sampling: RatioSampling, query: EstimateQuery, policy: CalibrationPolicy): Level[] {
  const level = (slice: CoefficientSlice, keep: (card: Card) => boolean): Level[] => {
    const samples = sampling.samples.filter((sample) => keep(sample.card));
    return policy.weight(samples.length) > 0 ? [{ slice, samples }] : [];
  };
  const overall = level({ kind: 'overall' }, () => true);
  if (overall.length === 0) {
    return [];
  }
  const technology = query.stack.values
    .flatMap((key) => level({ kind: 'stack', key }, (card) => card.task.stack.includes(key)))
    .sort((a, b) => b.samples.length - a.samples.length || keyOf(a.slice).localeCompare(keyOf(b.slice)))
    .slice(0, 1);
  const type = query.type?.value;
  const byType = type === undefined ? [] : level({ kind: 'type', key: type }, (card) => sampling.typeOf(card) === type);
  return [...overall, ...technology, ...byType];
}

function keyOf(slice: CoefficientSlice): string {
  return slice.kind === 'overall' ? '' : slice.key;
}
