import { InvalidValue } from '../shared/domain-error.js';
import { Duration } from './duration.js';

export const DEFAULT_IDLE_MINUTES = 30;
export const MIN_IDLE_MINUTES = 1;
export const MAX_IDLE_MINUTES = 240;

/**
 * The idle threshold: a silence longer than this is a pause, not work.
 * The only policy for now; it becomes a Strategy when a second one appears.
 */
export class IdlePolicy {
  private constructor(readonly threshold: Duration) {}

  static readonly DEFAULT = new IdlePolicy(Duration.ofMinutes(DEFAULT_IDLE_MINUTES));

  static ofMinutes(minutes: number): IdlePolicy {
    if (!Number.isInteger(minutes) || minutes < MIN_IDLE_MINUTES || minutes > MAX_IDLE_MINUTES) {
      throw new InvalidValue(
        `idle threshold must be a whole number of minutes from ${MIN_IDLE_MINUTES} to ${MAX_IDLE_MINUTES}, got ${minutes}`,
      );
    }
    return new IdlePolicy(Duration.ofMinutes(minutes));
  }
}
