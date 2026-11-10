import type { Card } from '../card/card.js';
import { normalized } from './calibration.js';

/** Cards of other authors once aliases are folded into their ids: shown, never used for the author's calibration. */
export function otherAuthors(cards: readonly Card[], author: string, aliases: ReadonlyMap<string, string>): number {
  return normalized(cards, aliases).filter((card) => card.author !== author).length;
}
