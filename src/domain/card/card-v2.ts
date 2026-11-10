import type { Card, CardFact } from './card.js';

/** The fact as cards of schemas 1 and 2 hold it: without its bounds. */
export type CardFactV2 = Omit<CardFact, 'lowMinutes' | 'highMinutes'>;

/** A card of schema 2, as `estimate-mode` and earlier wrote it. */
export interface CardV2 extends Omit<Card, 'schemaVersion' | 'fact' | 'usage' | 'convertedFrom'> {
  readonly schemaVersion: 2;
  readonly fact: CardFactV2 & { readonly counted: CardFactV2 & { readonly sequentialMinutes: number | null; readonly minimal: boolean } };
  readonly convertedFrom?: 1;
}

/** A card of schema 2 by its fields, when the journal of its task is not on this machine: no bounds of the fact, no usage. */
export function upgradeCardV2(card: CardV2): Card {
  const bounds = { lowMinutes: null, highMinutes: null };
  return {
    ...card,
    schemaVersion: 3,
    fact: { ...card.fact, ...bounds, counted: { ...card.fact.counted, ...bounds } },
    usage: null,
    convertedFrom: card.convertedFrom ?? 2,
  };
}
