import type { Card } from '../card/card.js';

export type Exclusion =
  | 'abandoned'
  | 'zero-fact'
  | 'manual-only'
  | 'renegotiated-without-groups'
  | 'renegotiated-after-revision'
  | 'estimated-after-start'
  | 'card-v1';

export function exclusion(card: Card): Exclusion | undefined {
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

/** Exclusions of the slice of revised tasks: by the counted fact, which they are compared by. */
export function revisedExclusion(card: Card): Exclusion | undefined {
  if (card.outcome === 'abandoned') {
    return 'abandoned';
  }
  if (card.estimatedAfterStart) {
    return 'estimated-after-start';
  }
  // A card of schema 1 has neither the current estimate nor the counted fact.
  if (card.convertedFrom === 1) {
    return 'card-v1';
  }
  if (card.fact.counted.totalMinutes === 0) {
    return 'zero-fact';
  }
  if (card.fact.counted.minimal) {
    return 'manual-only';
  }
  return undefined;
}

/**
 * Fact over the estimate before calibration. A parallel task counts with its
 * sequential equivalent; a renegotiated original only against the parts it did.
 */
export function ratioOf(card: Card): number | undefined {
  const minutes = card.parallel.used && card.parallel.sequentialMinutes !== null ? card.parallel.sequentialMinutes : card.fact.totalMinutes;
  return against(card.estimate, card.parts, card.outcome, minutes);
}

/** Counted fact over the current estimate: how good the estimate made at the revision was. */
export function revisedRatioOf(card: Card): number | undefined {
  const counted = card.fact.counted;
  const minutes = card.parallel.used && counted.sequentialMinutes !== null ? counted.sequentialMinutes : counted.totalMinutes;
  return against(card.currentEstimate, card.currentParts, card.outcome, minutes);
}

function against(estimate: Card['estimate'], parts: Card['parts'], outcome: Card['outcome'], minutes: number): number | undefined {
  if (estimate === null) {
    return undefined;
  }
  let base = estimate.baseLikelyHours;
  if (outcome === 'renegotiated') {
    const done = parts.filter((part) => part.groupDone === true);
    if (done.length === 0) {
      return undefined;
    }
    const coefficient = estimate.coefficient ?? 1;
    base = done.reduce((sum, part) => sum + part.likelyHours, 0) / coefficient;
  }
  return base > 0 ? minutes / 60 / base : undefined;
}

/**
 * How a closed task counts in the main ratio of calibration: its ratio, or why
 * it is left out. `emt similar` shows the same, so the two never disagree.
 */
export function taskRatio(card: Card): { readonly ratio: number } | { readonly excluded: Exclusion } | undefined {
  if (card.estimate === null) {
    return undefined;
  }
  const reason = exclusion(card);
  if (reason !== undefined) {
    return { excluded: reason };
  }
  const ratio = ratioOf(card);
  return ratio === undefined ? { excluded: 'renegotiated-without-groups' } : { ratio };
}
