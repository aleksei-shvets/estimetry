import type { Card } from '../../domain/card/card.js';

/** `cards/<task>.yaml`: cards of closed tasks, a projection `emt rebuild` can write again. */
export interface CardStore {
  write(card: Card): void;
  read(task: string): Card | undefined;
  remove(task: string): void;
  /** Every card that can be read; broken ones are skipped. */
  list(): Card[];
}
