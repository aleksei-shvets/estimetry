import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';
import { Duration } from './duration.js';

/** A closed stretch of time `[start, end]`. */
export class Interval {
  private constructor(
    readonly start: Timestamp,
    readonly end: Timestamp,
  ) {}

  static of(start: Timestamp, end: Timestamp): Interval {
    if (end.toMillis() < start.toMillis()) {
      throw new InvalidValue(`interval ends (${end.toISOString()}) before it starts (${start.toISOString()})`);
    }
    return new Interval(start, end);
  }

  /** The interval of `duration` that ends at `end`. */
  static endingAt(end: Timestamp, duration: Duration): Interval {
    return new Interval(Timestamp.fromMillis(end.toMillis() - duration.millis), end);
  }

  get duration(): Duration {
    return Duration.between(this.start, this.end);
  }

  /** True if the two share more than a single point. */
  overlaps(other: Interval): boolean {
    return (
      Math.min(this.end.toMillis(), other.end.toMillis()) > Math.max(this.start.toMillis(), other.start.toMillis())
    );
  }
}
