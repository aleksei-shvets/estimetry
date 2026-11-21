import type { Card } from '../card/card.js';
import type { CalibrationPolicy } from './calibration-policy.js';
import { levelParts, type CoefficientSlice, type LevelQuery } from './level-parts.js';
import { ratioSampling } from './ratio-samples.js';
import { median, round } from './statistics.js';

export type { CoefficientSlice } from './level-parts.js';

/** The spread of the ratio in logarithms the pessimistic coefficient reserves for: a factor of 2 at one task. */
const SIGMA = Math.log(2);

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

/**
 * The coefficient an estimate may apply (calibration-query spec), from the
 * cards of one author. Going down the levels (`levelParts`), each part shrinks
 * towards the level above in logarithms by the weight of its own tasks; the
 * overall part towards 1, an empty part equals the level above. The deepest
 * level is applied: its part is its whole slice. A new estimate takes the main
 * ratio; a revision of a task in progress, `revised`.
 */
export function applicableCoefficient(
  cards: readonly Card[],
  query: LevelQuery & { readonly revise?: boolean },
  policy: CalibrationPolicy,
): ApplicableCoefficient | null {
  const parts = levelParts(ratioSampling(cards, query.revise === true), query, policy);
  const applied = parts.at(-1);
  if (applied === undefined) {
    return null;
  }
  let logarithm = 0;
  for (const part of parts) {
    const middle = median(part.ratios);
    if (middle !== null) {
      const weight = policy.partWeight(part.ratios.length);
      logarithm = weight * Math.log(middle) + (1 - weight) * logarithm;
    }
  }
  const n = applied.ratios.length;
  const value = Math.exp(logarithm);
  const upper = value * Math.exp(SIGMA / Math.sqrt(n));
  return {
    value: round(value),
    pessimistic: round(value < 1 ? Math.min(1, upper) : upper),
    slice: applied.slice,
    n,
    weight: round(policy.partWeight(n)),
  };
}
