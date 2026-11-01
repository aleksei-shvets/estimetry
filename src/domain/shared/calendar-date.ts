import { InvalidValue } from './domain-error.js';
import type { Timestamp } from './timestamp.js';

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A calendar day, `YYYY-MM-DD`, e.g. the date in the name of an archived OpenSpec change. */
export class CalendarDate {
  private constructor(
    readonly value: string,
    /** Midnight UTC of the day, for comparisons. */
    private readonly millis: number,
  ) {}

  static parse(value: string): CalendarDate {
    const match = PATTERN.exec(value);
    const millis = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
    // Date.UTC rolls 2026-02-30 over to March; a valid date formats back to itself.
    if (Number.isNaN(millis) || new Date(millis).toISOString().slice(0, 10) !== value) {
      throw new InvalidValue(`invalid date "${value}", expected YYYY-MM-DD`);
    }
    return new CalendarDate(value, millis);
  }

  /** The day of a moment in UTC. */
  static of(moment: Timestamp): CalendarDate {
    return CalendarDate.parse(moment.toISOString().slice(0, 10));
  }

  minusDays(days: number): CalendarDate {
    return CalendarDate.parse(new Date(this.millis - days * DAY_MS).toISOString().slice(0, 10));
  }

  compare(other: CalendarDate): number {
    return this.millis - other.millis;
  }

  isBefore(other: CalendarDate): boolean {
    return this.millis < other.millis;
  }

  toString(): string {
    return this.value;
  }
}
