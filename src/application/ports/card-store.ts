import type { Card } from '../../domain/card/card.js';
import type { CardV1 } from '../../domain/card/card-v1.js';

/** A card as it lies in the store: of the current schema, of schema 1, or of a schema newer than this binary. */
export type StoredCard =
  | { readonly schema: 'current'; readonly card: Card }
  | { readonly schema: 'v1'; readonly card: CardV1 }
  | { readonly schema: 'newer'; readonly task: string; readonly version: number };

/** `cards/<task>.yaml`: cards of closed tasks, a projection `emt rebuild` can write again. */
export interface CardStore {
  write(card: Card): void;
  read(task: string): StoredCard | undefined;
  remove(task: string): void;
  /** Every card that can be read; broken ones are skipped. */
  list(): StoredCard[];
}
