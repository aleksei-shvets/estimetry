import type { StackLabels } from '../estimate/stack-labels.js';
import type { AuthorCalibration, RatioSlices, RatioStats } from './calibration.js';
import type { CalibrationPolicy } from './calibration-policy.js';
import { round } from './statistics.js';

/** The spread of the ratio in logarithms the pessimistic coefficient reserves for: a factor of 2 at one task. */
const SIGMA = Math.log(2);

export type CoefficientSlice = { readonly kind: 'overall' } | { readonly kind: 'type' | 'stack'; readonly key: string };

export interface ApplicableCoefficient {
  /** What the optimistic and most likely hours of every part are multiplied by. */
  readonly value: number;
  /** What the pessimistic hours are multiplied by: a reserve while the tasks are few. */
  readonly pessimistic: number;
  /** The deepest level with tasks: the one the coefficient comes from. */
  readonly slice: CoefficientSlice;
  /** Tasks of that level. */
  readonly n: number;
  /** The weight of its own median against the level above. */
  readonly weight: number;
}

interface Level {
  readonly slice: CoefficientSlice;
  readonly stats: RatioStats & { readonly median: number };
}

/**
 * The coefficient an estimate may apply (calibration-query spec). Each level
 * shrinks towards its parent in logarithms by its weight: overall towards 1,
 * the technology of the query with the most tasks towards overall, the type
 * of the query towards the technology. The deepest level with a weight above
 * 0 is applied; without a weight in the overall slice there is no coefficient.
 * A new estimate takes the main ratio; a revision of a task in progress, `revised`.
 */
export function applicableCoefficient(
  author: AuthorCalibration | undefined,
  query: { readonly type?: string; readonly stack: StackLabels; readonly revise?: boolean },
  policy: CalibrationPolicy,
): ApplicableCoefficient | null {
  if (author === undefined) {
    return null;
  }
  const levels = levelsOf(query.revise ? author.revised : author.ratio, query, policy);
  let logarithm = 0;
  let applied: (Level & { readonly weight: number }) | undefined;
  for (const level of levels) {
    const weight = policy.weight(level.stats.n);
    logarithm = weight * Math.log(level.stats.median) + (1 - weight) * logarithm;
    applied = { ...level, weight };
  }
  if (applied === undefined) {
    return null;
  }
  const value = Math.exp(logarithm);
  const upper = value * Math.exp(SIGMA / Math.sqrt(applied.stats.n));
  return {
    value: round(value),
    pessimistic: round(value < 1 ? Math.min(1, upper) : upper),
    slice: applied.slice,
    n: applied.stats.n,
    weight: round(applied.weight),
  };
}

/** The chain of levels with a weight above 0, from overall to the type. */
function levelsOf(
  slices: RatioSlices,
  query: { readonly type?: string; readonly stack: StackLabels },
  policy: CalibrationPolicy,
): Level[] {
  const counted = (stats: RatioStats | undefined): stats is Level['stats'] =>
    stats !== undefined && stats.median !== null && policy.weight(stats.n) > 0;
  if (!counted(slices.overall)) {
    return [];
  }
  const levels: Level[] = [{ slice: { kind: 'overall' }, stats: slices.overall }];
  const technology = query.stack.values
    .flatMap((key) => {
      const stats = slices.byStack[key];
      return counted(stats) ? [{ slice: { kind: 'stack', key } as const, stats }] : [];
    })
    .sort((a, b) => b.stats.n - a.stats.n || a.slice.key.localeCompare(b.slice.key))[0];
  if (technology !== undefined) {
    levels.push(technology);
  }
  const byType = query.type === undefined ? undefined : slices.byType[query.type];
  if (query.type !== undefined && counted(byType)) {
    levels.push({ slice: { kind: 'type', key: query.type }, stats: byType });
  }
  return levels;
}
