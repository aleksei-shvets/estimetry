import type { StackLabels } from '../estimate/stack-labels.js';
import type { AuthorCalibration, RatioStats } from './calibration.js';

export interface ApplicableCoefficient {
  /** The median of the slice: what the hours of every part are multiplied by. */
  readonly value: number;
  readonly slice: { readonly kind: 'type' | 'stack'; readonly key: string };
  readonly n: number;
}

/**
 * The coefficient an estimate may apply (calibration-query spec): the first
 * slice with enough tasks — by type, then by the technology with the most
 * tasks. The overall slice mixes every type and stack, so it is never applied.
 * A new estimate takes the main ratio; a revision of a task in progress, `revised`.
 */
export function applicableCoefficient(
  author: AuthorCalibration | undefined,
  query: { readonly type?: string; readonly stack: StackLabels; readonly revise?: boolean },
): ApplicableCoefficient | null {
  if (author === undefined) {
    return null;
  }
  const slices = query.revise ? author.revised : author.ratio;
  const usable = (stats: RatioStats | undefined): stats is RatioStats & { median: number } =>
    stats?.applicable === true && stats.median !== null;
  const byType = query.type === undefined ? undefined : slices.byType[query.type];
  if (query.type !== undefined && usable(byType)) {
    return { value: byType.median, slice: { kind: 'type', key: query.type }, n: byType.n };
  }
  const stacks = query.stack.values
    .flatMap((key) => {
      const stats = slices.byStack[key];
      return usable(stats) ? [{ key, stats }] : [];
    })
    .sort((a, b) => b.stats.n - a.stats.n || a.key.localeCompare(b.key));
  const best = stacks[0];
  return best === undefined ? null : { value: best.stats.median, slice: { kind: 'stack', key: best.key }, n: best.stats.n };
}
