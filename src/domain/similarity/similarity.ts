import type { Card } from '../card/card.js';
import { normalized } from '../calibration/calibration.js';
import { taskRatio } from '../calibration/task-ratio.js';
import { stackLabels } from '../estimate/stack-labels.js';
import { Timestamp } from '../shared/timestamp.js';

export const DEFAULT_SIMILAR_LIMIT = 5;

const WEIGHTS = { stack: 0.5, type: 0.3, size: 0.2 } as const;
/** Four times bigger or smaller is not similar in size at all. */
const SIZE_SPAN = Math.log(4);

export interface SimilarityQuery {
  readonly author: string;
  /** Earlier ids of the same author: their cards are the author's. */
  readonly aliases?: ReadonlyMap<string, string>;
  readonly type?: string;
  readonly stack: readonly string[];
  /** Preliminary most likely hours of the new task, before calibration. */
  readonly hours?: number;
  readonly limit?: number;
}

export interface SimilarTask {
  readonly card: Card;
  readonly score: number;
  /** What the score is made of; a component absent here did not count. */
  readonly matched: {
    readonly stack?: { readonly common: readonly string[]; readonly share: number };
    readonly type?: boolean;
    /** The base of the card's first estimate over `hours`. */
    readonly size?: { readonly ratio: number; readonly share: number };
  };
  /** As the main ratio of calibration counts the task; undefined without an estimate. */
  readonly ratio: ReturnType<typeof taskRatio>;
}

/**
 * Closed tasks of the author like the new one (similar-tasks spec): by the
 * labels of the stack, the type of the first estimate and the size, weighted
 * and normalised over the components the query and the card both have.
 */
export function similarTasks(cards: readonly Card[], query: SimilarityQuery): SimilarTask[] {
  const stack = stackLabels(query.stack);
  const scored: SimilarTask[] = [];
  for (const card of normalized(cards, query.aliases)) {
    if (card.author !== query.author || card.outcome === 'abandoned') {
      continue;
    }
    const parts: { weight: number; value: number }[] = [];
    const matched: { stack?: { common: string[]; share: number }; type?: boolean; size?: { ratio: number; share: number } } = {};
    if (stack.length > 0 && card.task.stack.length > 0) {
      const common = stack.filter((label) => card.task.stack.includes(label));
      const share = common.length / new Set([...stack, ...card.task.stack]).size;
      matched.stack = { common, share: round(share) };
      parts.push({ weight: WEIGHTS.stack, value: share });
    }
    if (query.type !== undefined) {
      matched.type = typeOf(card) === query.type;
      parts.push({ weight: WEIGHTS.type, value: matched.type ? 1 : 0 });
    }
    const base = card.estimate?.baseLikelyHours;
    if (query.hours !== undefined && query.hours > 0 && base !== undefined && base > 0) {
      const share = Math.max(0, 1 - Math.abs(Math.log(base / query.hours)) / SIZE_SPAN);
      matched.size = { ratio: round(base / query.hours), share: round(share) };
      parts.push({ weight: WEIGHTS.size, value: share });
    }
    // Only a task sharing a technology or the type is similar at all.
    if ((matched.stack?.common.length ?? 0) === 0 && matched.type !== true) {
      continue;
    }
    const weight = parts.reduce((sum, part) => sum + part.weight, 0);
    const score = weight === 0 ? 0 : parts.reduce((sum, part) => sum + part.weight * part.value, 0) / weight;
    scored.push({ card, score: round(score), matched, ratio: taskRatio(card) });
  }
  return scored
    .sort((a, b) => b.score - a.score || Timestamp.parse(b.card.closedAt).toMillis() - Timestamp.parse(a.card.closedAt).toMillis())
    .slice(0, query.limit ?? DEFAULT_SIMILAR_LIMIT);
}

/** The type of the first estimate, as the main ratio of calibration takes it; the task's without an estimate. */
export function typeOf(card: Card): string {
  return card.estimate?.type ?? card.task.type;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
