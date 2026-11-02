import { Timestamp } from '../shared/timestamp.js';
import { Duration } from './duration.js';
import { Interval } from './interval.js';

/** The earliest moment a JavaScript date can represent. */
const EARLIEST = Timestamp.fromMillis(-8.64e15);

/**
 * A union of intervals kept sorted and merged: overlapping and touching
 * intervals become one, so `total` never counts the same moment twice.
 */
export class IntervalSet {
  static readonly EMPTY = new IntervalSet([]);

  private constructor(readonly intervals: readonly Interval[]) {}

  static of(intervals: Iterable<Interval>): IntervalSet {
    const sorted = [...intervals]
      .filter((interval) => interval.duration.millis > 0)
      .sort((a, b) => a.start.toMillis() - b.start.toMillis());
    const merged: Interval[] = [];
    for (const interval of sorted) {
      const last = merged.at(-1);
      if (last && interval.start.toMillis() <= last.end.toMillis()) {
        if (interval.end.toMillis() > last.end.toMillis()) {
          merged[merged.length - 1] = Interval.of(last.start, interval.end);
        }
      } else {
        merged.push(interval);
      }
    }
    return new IntervalSet(merged);
  }

  get total(): Duration {
    return Duration.sum(this.intervals.map((interval) => interval.duration));
  }

  union(other: IntervalSet): IntervalSet {
    return IntervalSet.of([...this.intervals, ...other.intervals]);
  }

  /** Everything in this set that is not covered by `other`. */
  minus(other: IntervalSet): IntervalSet {
    const result: Interval[] = [];
    for (const interval of this.intervals) {
      let cursor = interval.start.toMillis();
      const end = interval.end.toMillis();
      for (const cut of other.intervals) {
        const cutStart = cut.start.toMillis();
        const cutEnd = cut.end.toMillis();
        if (cutEnd <= cursor || cutStart >= end) {
          continue;
        }
        if (cutStart > cursor) {
          result.push(Interval.of(Timestamp.fromMillis(cursor), cut.start));
        }
        cursor = Math.max(cursor, cutEnd);
      }
      if (cursor < end) {
        result.push(Interval.of(Timestamp.fromMillis(cursor), interval.end));
      }
    }
    return IntervalSet.of(result);
  }

  /** The part of the set that lies at or after `from`. */
  from(from: Timestamp): IntervalSet {
    return this.minus(IntervalSet.of([Interval.of(EARLIEST, from)]));
  }

  /** The part of the set inside `[from, to]`. */
  within(from: Timestamp, to: Timestamp): IntervalSet {
    if (to.toMillis() <= from.toMillis()) {
      return IntervalSet.EMPTY;
    }
    return IntervalSet.of(
      this.intervals
        .filter((interval) => interval.end.toMillis() > from.toMillis() && interval.start.toMillis() < to.toMillis())
        .map((interval) =>
          Interval.of(
            Timestamp.fromMillis(Math.max(interval.start.toMillis(), from.toMillis())),
            Timestamp.fromMillis(Math.min(interval.end.toMillis(), to.toMillis())),
          ),
        ),
    );
  }

  overlaps(interval: Interval): boolean {
    return this.intervals.some((own) => own.overlaps(interval));
  }
}
