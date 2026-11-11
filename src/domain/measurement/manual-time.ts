import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';
import { Duration } from './duration.js';
import { Interval } from './interval.js';

export const MANUAL_TIME_KINDS = ['user', 'agent'] as const;
export type ManualTimeKind = (typeof MANUAL_TIME_KINDS)[number];

export interface ManualTimeData {
  readonly kind: ManualTimeKind;
  readonly durationMs: number;
  /** End of the work; absent when the user did not say when it happened. */
  readonly at?: string;
  readonly description: string;
  /** Id of the estimate part the time belongs to, e.g. manual testing. */
  readonly part?: string;
}

/**
 * Time recorded by hand: the user's work outside agent sessions, or agent work
 * that hooks did not see (`kind: agent`). With `at` it is an interval that
 * merges with measured time; without it, it is added on top.
 */
export class ManualTime {
  private constructor(
    readonly kind: ManualTimeKind,
    readonly duration: Duration,
    readonly at: Timestamp | undefined,
    readonly description: string,
    readonly part: string | undefined,
  ) {}

  static of(input: {
    readonly kind: ManualTimeKind;
    readonly duration: Duration;
    readonly at?: Timestamp;
    readonly description: string;
    readonly part?: string;
  }): ManualTime {
    const description = input.description.trim();
    if (description === '') {
      throw new InvalidValue('manual time needs a description');
    }
    if (input.duration.millis === 0) {
      throw new InvalidValue('manual time must be greater than zero');
    }
    const part = input.part?.trim();
    if (part === '') {
      throw new InvalidValue('estimate part id must not be empty');
    }
    return new ManualTime(input.kind, input.duration, input.at, description, part);
  }

  static fromData(data: ManualTimeData): ManualTime {
    return ManualTime.of({
      kind: data.kind,
      duration: Duration.ofMillis(data.durationMs),
      ...(data.at === undefined ? {} : { at: Timestamp.parse(data.at) }),
      description: data.description,
      ...(data.part === undefined ? {} : { part: data.part }),
    });
  }

  /** The interval of a record that ends at `at`; undefined for a record without a moment. */
  interval(): Interval | undefined {
    return this.at === undefined ? undefined : Interval.endingAt(this.at, this.duration);
  }

  toData(): ManualTimeData {
    return {
      kind: this.kind,
      durationMs: this.duration.millis,
      ...(this.at === undefined ? {} : { at: this.at.toISOString() }),
      description: this.description,
      ...(this.part === undefined ? {} : { part: this.part }),
    };
  }
}

/**
 * Manual time a task knew of by `until`: recorded by then and, when the record
 * names when the work ended, ended by then. A record of a snapshot that did not
 * keep its moment counts as known.
 */
export function manualKnownBy(
  records: readonly { readonly manual: ManualTime; readonly recordedAt?: Timestamp }[],
  until: Timestamp,
): ManualTime[] {
  const by = (moment: Timestamp | undefined) => moment === undefined || moment.toMillis() <= until.toMillis();
  return records.filter(({ manual, recordedAt }) => by(recordedAt) && by(manual.at)).map(({ manual }) => manual);
}
