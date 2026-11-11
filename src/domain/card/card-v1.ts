import type { Card, CardEstimate, CardPart } from './card.js';
import { noExtraTallies } from './extra-tallies.js';
import { upgradeCardV2, type CardFactV2, type CardV2 } from './card-v2.js';

/** A card of schema 1, as `estimate-revision` and earlier wrote it. */
export interface CardV1 extends Omit<
  Card,
  'schemaVersion' | 'estimate' | 'currentEstimate' | 'revisions' | 'fact' | 'currentParts' | 'beforeRevisionMinutes' | 'coveredByRevision' | 'convertedFrom' | 'text' | 'usage'
> {
  readonly schemaVersion: 1;
  readonly estimate: Omit<CardEstimate, 'type'> | null;
  readonly fact: CardFactV2;
  readonly parts: readonly CardPart[];
  readonly text: Omit<Card['text'], 'currentParts' | 'revisions'>;
}

/**
 * A card of schema 1 by its fields, when the journal of its task is not on
 * this machine. It has no current estimate and no counted fact: a revised
 * task is marked so that calibration leaves it out of the sections that need them.
 */
export function upgradeCardV1(card: CardV1): Card {
  const estimate = card.estimate === null ? null : { ...card.estimate, type: card.task.type };
  const v2: CardV2 = {
    ...card,
    schemaVersion: 2,
    estimate,
    currentEstimate: estimate,
    revisions: [],
    fact: {
      ...card.fact,
      counted: { ...card.fact, sequentialMinutes: card.parallel.sequentialMinutes, minimal: card.accuracy === 'minimal' },
    },
    currentParts: card.parts,
    beforeRevisionMinutes: 0,
    coveredByRevision: noExtraTallies(),
    convertedFrom: 1,
    text: { ...card.text, currentParts: card.text.parts, revisions: [] },
  };
  return upgradeCardV2(v2);
}
