import type { Card } from '../../domain/card/card.js';
import type { CardV1 } from '../../domain/card/card-v1.js';
import type { CardV2 } from '../../domain/card/card-v2.js';
import type { TaskId } from '../../domain/task/task-id.js';

/** A card as it lies in the store: of the current schema, of an older one, or of a schema newer than this binary. */
export type StoredCard =
  | { readonly schema: 'current'; readonly card: Card }
  | { readonly schema: 'v1'; readonly card: CardV1 }
  | { readonly schema: 'v2'; readonly card: CardV2 }
  | { readonly schema: 'newer'; readonly task: TaskId; readonly version: number };

/** `cards/<task>.yaml`: cards of closed tasks, a projection `emt rebuild` can write again. */
export interface CardStore {
  write(card: Card): void;
  read(task: TaskId): StoredCard | undefined;
  remove(task: TaskId): void;
  /** Every card that can be read; broken ones are skipped. */
  list(): StoredCard[];
}
