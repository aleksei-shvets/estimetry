import { InvalidValue } from '../shared/domain-error.js';
import type { Timestamp } from '../shared/timestamp.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PATTERN = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/;

/** Longest duration a single record may claim. */
export const MAX_RECORD_DURATION_HOURS = 24;

/** A non-negative length of time with millisecond precision. Rounding happens only when it is shown. */
export class Duration {
  static readonly ZERO = new Duration(0);

  private constructor(readonly millis: number) {}

  static ofMillis(millis: number): Duration {
    if (!Number.isFinite(millis) || millis < 0) {
      throw new InvalidValue(`invalid duration: ${millis} ms`);
    }
    return new Duration(Math.round(millis));
  }

  static ofMinutes(minutes: number): Duration {
    return Duration.ofMillis(minutes * MINUTE);
  }

  static ofHours(hours: number): Duration {
    return Duration.ofMillis(hours * HOUR);
  }

  /** Time from `from` to `to`; zero if `to` is not later. */
  static between(from: Timestamp, to: Timestamp): Duration {
    return new Duration(Math.max(0, to.toMillis() - from.toMillis()));
  }

  /**
   * A duration typed by the user: `40m`, `1h30m`, `1.5h`. It must be positive
   * and at most 24 hours, which is what a single record can sensibly claim.
   */
  static parse(text: string): Duration {
    const trimmed = text.trim();
    const match = PATTERN.exec(trimmed);
    if (trimmed === '' || !match || (match[1] === undefined && match[2] === undefined)) {
      throw new InvalidValue(`invalid duration "${text}", expected e.g. 40m, 1h30m or 1.5h`);
    }
    const duration = Duration.ofMillis(Number(match[1] ?? 0) * HOUR + Number(match[2] ?? 0) * MINUTE);
    if (duration.millis === 0) {
      throw new InvalidValue(`duration "${text}" must be greater than zero`);
    }
    if (duration.millis > MAX_RECORD_DURATION_HOURS * HOUR) {
      throw new InvalidValue(`duration "${text}" must be at most ${MAX_RECORD_DURATION_HOURS}h`);
    }
    return duration;
  }

  get minutes(): number {
    return this.millis / MINUTE;
  }

  get hours(): number {
    return this.millis / HOUR;
  }

  plus(other: Duration): Duration {
    return new Duration(this.millis + other.millis);
  }

  /** Difference, never below zero. */
  minus(other: Duration): Duration {
    return new Duration(Math.max(0, this.millis - other.millis));
  }

  isLongerThan(other: Duration): boolean {
    return this.millis > other.millis;
  }

  equals(other: Duration): boolean {
    return this.millis === other.millis;
  }

  static sum(durations: Iterable<Duration>): Duration {
    let total = 0;
    for (const duration of durations) {
      total += duration.millis;
    }
    return new Duration(total);
  }
}
