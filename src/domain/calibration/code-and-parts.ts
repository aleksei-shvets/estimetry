import type { Card } from '../card/card.js';
import { median } from './statistics.js';

/*
 * What the cards of an author say about code and parts of estimates: the
 * accuracy of the estimated code volume, lines per hour by technology, and
 * the fact over the estimate by the kind of a part.
 */

/** A revised task tells about the parts of its current estimate only if little was done before the revision. */
const BEFORE_REVISION_LIMIT = 0.05;

export interface ShareStats {
  readonly n: number;
  readonly median: number | null;
}

export interface VolumeStats {
  readonly within: number;
  readonly below: number;
  readonly above: number;
  readonly median: number | null;
}

export interface PartsStats {
  readonly byKind: Readonly<Record<string, ShareStats>>;
  readonly excluded: number;
}

/** A card of a task whose estimate was revised; cards of schema 1 only say so by `revised`. */
export function isRevised(card: Card): boolean {
  return card.revised === true || card.revisions.length > 0;
}

export function volumeAccuracy(cards: readonly Card[], kind: 'production' | 'tests'): VolumeStats {
  let within = 0;
  let below = 0;
  let above = 0;
  const ratios: number[] = [];
  for (const card of cards) {
    const range = card.estimate?.codeVolume?.[kind];
    const lines = card.code?.lines[kind];
    if (range === undefined || lines === undefined || card.code?.projects.some((p) => p.source === 'unknown')) {
      continue;
    }
    const [min, max] = range;
    if (lines.added < min) {
      below += 1;
    } else if (lines.added > max) {
      above += 1;
    } else {
      within += 1;
    }
    const middle = (min + max) / 2;
    if (middle > 0) {
      ratios.push(lines.added / middle);
    }
  }
  return { within, below, above, median: median(ratios) };
}

export function linesPerHour(cards: readonly Card[]): Record<string, ShareStats> {
  const values = new Map<string, number[]>();
  for (const card of cards) {
    if (card.code === null || card.fact.totalMinutes === 0) {
      continue;
    }
    const lines = card.code.lines.production.added + card.code.lines.tests.added;
    for (const tech of card.task.stack) {
      const list = values.get(tech) ?? [];
      list.push(lines / (card.fact.totalMinutes / 60));
      values.set(tech, list);
    }
  }
  return Object.fromEntries([...values].sort().map(([tech, list]) => [tech, { n: list.length, median: median(list) }]));
}

/**
 * Only parts alone in their group: the time of a shared group says nothing
 * about one kind. A revised task gives the parts of its current estimate, if
 * little of its counted fact was spent before the revision.
 */
export function partsByKind(cards: readonly Card[]): PartsStats {
  const values = new Map<string, number[]>();
  let excluded = 0;
  for (const card of cards) {
    // A revised card of schema 1 has no fact by the parts of its current estimate.
    if (card.convertedFrom === 1 && isRevised(card)) {
      excluded += 1;
      continue;
    }
    if (card.partsFact !== 'by-checkboxes') {
      continue;
    }
    if (isRevised(card)) {
      const counted = card.fact.counted.totalMinutes;
      if (counted === 0 || card.beforeRevisionMinutes / counted > BEFORE_REVISION_LIMIT) {
        excluded += 1;
        continue;
      }
    }
    const coefficient = card.currentEstimate?.coefficient ?? 1;
    for (const part of card.currentParts) {
      if (!part.soleInGroup || part.factMinutes === null || part.likelyHours === 0) {
        continue;
      }
      const list = values.get(part.kind) ?? [];
      list.push(part.factMinutes / 60 / (part.likelyHours / coefficient));
      values.set(part.kind, list);
    }
  }
  return {
    byKind: Object.fromEntries([...values].sort().map(([kind, list]) => [kind, { n: list.length, median: median(list) }])),
    excluded,
  };
}
