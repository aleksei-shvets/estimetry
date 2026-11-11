import type { Estimate } from '../estimate/estimate.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { RetroReason, TaskRetroRecorded } from './task-events.js';

/** The data of `task.retro-recorded`: at least one reason and one lesson. */
export function retroData(estimate: Estimate | undefined, reasons: readonly string[], lesson: string): TaskRetroRecorded['data'] {
  const parsed = reasons.map((reason) => retroReason(estimate, reason)).filter((reason) => reason.text !== '');
  if (parsed.length === 0) {
    throw new InvalidValue('a retro needs at least one reason');
  }
  const trimmed = lesson.trim();
  if (trimmed === '') {
    throw new InvalidValue('a retro needs one lesson for the future');
  }
  return { reasons: parsed, lesson: trimmed };
}

/**
 * A reason may start with `<part>:` — the id of a part, or the group of a
 * part alone in its group (people name parts by their change). Any other
 * prefix is plain text.
 */
function retroReason(estimate: Estimate | undefined, reason: string): RetroReason {
  const text = reason.trim();
  const colon = text.indexOf(':');
  const prefix = colon < 0 ? '' : text.slice(0, colon).trim();
  const parts = estimate?.parts ?? [];
  const byId = parts.find((part) => part.id === prefix);
  const byGroup = parts.filter((part) => part.group === prefix);
  const part = byId ?? (byGroup.length === 1 ? byGroup[0] : undefined);
  return prefix !== '' && part !== undefined ? { text: text.slice(colon + 1).trim(), part: part.id } : { text };
}
