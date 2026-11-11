import { EXTRA_CATEGORIES, type Extra, type ExtraAccounting, type ExtraCategory } from '../measurement/extra.js';
import type { Card, ExtraTally } from './card.js';

/** Extra work by category and accounting: how often, how often with time, how many minutes. */
export function tallyExtras(extras: readonly Extra[]): Card['extras'] {
  const absorbed = noExtraTallies();
  const renegotiated = noExtraTallies();
  const result = Object.fromEntries(
    EXTRA_CATEGORIES.map((category) => [category, { absorbed: absorbed[category], renegotiated: renegotiated[category] }]),
  ) as Record<ExtraCategory, Record<ExtraAccounting, ExtraTally>>;
  for (const extra of extras) {
    const tally = result[extra.category][extra.accounting];
    const time = extra.time;
    result[extra.category][extra.accounting] = {
      count: tally.count + 1,
      timed: tally.timed + (time === undefined ? 0 : 1),
      minutes: tally.minutes + (time === undefined ? 0 : Math.round(time.minutes)),
    };
  }
  return result;
}

/** A tally of no extra work for every category. */
export function noExtraTallies(): Record<ExtraCategory, ExtraTally> {
  return Object.fromEntries(EXTRA_CATEGORIES.map((category) => [category, { count: 0, timed: 0, minutes: 0 }])) as Record<
    ExtraCategory,
    ExtraTally
  >;
}

/** Extra work a revision with `exclude` covers: by category only. */
export function tallyCovered(extras: readonly Extra[]): Card['coveredByRevision'] {
  const result = noExtraTallies();
  for (const extra of extras) {
    const tally = result[extra.category];
    result[extra.category] = {
      count: tally.count + 1,
      timed: tally.timed + (extra.time === undefined ? 0 : 1),
      minutes: tally.minutes + (extra.time === undefined ? 0 : Math.round(extra.time.minutes)),
    };
  }
  return result;
}
