import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';
import { Duration } from './duration.js';

export const MANUAL_TIME_KINDS = ['user', 'agent'] as const;
export type ManualTimeKind = (typeof MANUAL_TIME_KINDS)[number];

export interface ManualTimeData {
  readonly kind: ManualTimeKind;
  readonly durationMs: number;
  /** End of the work; absent when the user did not say when it happened. */
  readonly at?: string;
  readonly description: string;
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
  ) {}

  static of(input: {
    readonly kind: ManualTimeKind;
    readonly duration: Duration;
    readonly at?: Timestamp;
    readonly description: string;
  }): ManualTime {
    const description = input.description.trim();
    if (description === '') {
      throw new InvalidValue('manual time needs a description');
    }
    if (input.duration.millis === 0) {
      throw new InvalidValue('manual time must be greater than zero');
    }
    return new ManualTime(input.kind, input.duration, input.at, description);
  }

  static fromData(data: ManualTimeData): ManualTime {
    return ManualTime.of({
      kind: data.kind,
      duration: Duration.ofMillis(data.durationMs),
      ...(data.at === undefined ? {} : { at: Timestamp.parse(data.at) }),
      description: data.description,
    });
  }

  toData(): ManualTimeData {
    return {
      kind: this.kind,
      durationMs: this.duration.millis,
      ...(this.at === undefined ? {} : { at: this.at.toISOString() }),
      description: this.description,
    };
  }
}
