import type { Card } from '../card/card.js';
import { isRevised } from './code-and-parts.js';
import { exclusion, ratioOf, revisedExclusion, revisedRatioOf, type Exclusion } from './task-ratio.js';

/** A card that counts in a ratio, with its ratio. */
export interface RatioSample {
  readonly card: Card;
  readonly ratio: number;
}

/** The cards of a ratio: those that count, and those left out with the reason. */
export interface RatioSampling {
  readonly samples: readonly RatioSample[];
  readonly excluded: readonly { readonly card: Card; readonly reason: Exclusion }[];
  /** The type a card counts under: of the first estimate, or of the current one for `revised`. */
  readonly typeOf: (card: Card) => string | undefined;
}

/**
 * Which cards a ratio counts and with what value (calibration spec): the main
 * ratio — whole fact over the first estimate; `revised` — counted fact over the
 * current estimate of revised tasks. Calibration slices and the applicable
 * coefficient both take it from here.
 */
export function ratioSampling(cards: readonly Card[], revised: boolean): RatioSampling {
  const estimated = cards.filter((card) => card.estimate !== null);
  return revised
    ? { ...sampled(estimated.filter(isRevised), revisedExclusion, revisedRatioOf), typeOf: (card) => card.currentEstimate?.type }
    : { ...sampled(estimated, exclusion, ratioOf), typeOf: (card) => card.estimate?.type };
}

function sampled(
  cards: readonly Card[],
  exclude: (card: Card) => Exclusion | undefined,
  ratio: (card: Card) => number | undefined,
): Omit<RatioSampling, 'typeOf'> {
  const samples: RatioSample[] = [];
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
