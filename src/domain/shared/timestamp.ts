import { InvalidValue } from './domain-error.js';

/** A point in time, stored as ISO 8601 UTC with milliseconds. */
export class Timestamp {
  private constructor(private readonly millis: number) {}

  static fromMillis(millis: number): Timestamp {
    if (!Number.isFinite(millis)) {
      throw new InvalidValue(`invalid timestamp: ${millis}`);
    }
    return new Timestamp(millis);
  }

  static parse(iso: string): Timestamp {
    const millis = Date.parse(iso);
    if (Number.isNaN(millis)) {
      throw new InvalidValue(`invalid timestamp: ${iso}`);
    }
    return new Timestamp(millis);
  }

  toMillis(): number {
    return this.millis;
  }

  toISOString(): string {
    return new Date(this.millis).toISOString();
  }

  toString(): string {
    return this.toISOString();
  }
}
