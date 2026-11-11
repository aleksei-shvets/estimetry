import { Interval } from '../measurement/interval.js';
import { CalendarDate } from '../shared/calendar-date.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { Timestamp } from '../shared/timestamp.js';

/** Slack around the window for the time a directory changed: file systems round it. */
const CHANGED_AT_SLACK_MS = 1_000;

/** An archived change as the window judges it: its date, and when its directory changed if that is known. */
export interface ArchiveMoment {
  readonly archivedOn: CalendarDate;
  /** Milliseconds; `0` or absent when the file system does not tell. */
  readonly changedAt?: number;
}

/** The window of work thrown away by a revision with `exclude` (estimate-revision spec): `[from, to]`. */
export class LostWindow {
  private constructor(
    readonly from: Timestamp,
    readonly to: Timestamp,
  ) {}

  static of(from: Timestamp, to: Timestamp): LostWindow {
    if (to.toMillis() < from.toMillis()) {
      throw new InvalidValue(`the window of lost work ends (${to.toISOString()}) before it starts (${from.toISOString()})`);
    }
    return new LostWindow(from, to);
  }

  /** The window `[from, to]`, or undefined when `to` is before `from`: for a window not checked yet. */
  static between(from: Timestamp, to: Timestamp): LostWindow | undefined {
    return to.toMillis() < from.toMillis() ? undefined : new LostWindow(from, to);
  }

  contains(moment: Timestamp): boolean {
    return moment.toMillis() >= this.from.toMillis() && moment.toMillis() <= this.to.toMillis();
  }

  /** True if the window had ended by `moment`. */
  endsBy(moment: Timestamp): boolean {
    return this.to.toMillis() <= moment.toMillis();
  }

  interval(): Interval {
    return Interval.of(this.from, this.to);
  }

  /**
   * True if the change was archived inside the window: by the time its
   * directory changed, give or take a second; else by its date, from the day
   * before the window starts (the date of the archive is a local one) to the
   * day the window ends.
   */
  holdsArchive(archive: ArchiveMoment): boolean {
    const { changedAt } = archive;
    if (changedAt !== undefined && changedAt > 0) {
      return changedAt >= this.from.toMillis() - CHANGED_AT_SLACK_MS && changedAt <= this.to.toMillis() + CHANGED_AT_SLACK_MS;
    }
    return !archive.archivedOn.isBefore(CalendarDate.of(this.from).minusDays(1)) && !CalendarDate.of(this.to).isBefore(archive.archivedOn);
  }
}
