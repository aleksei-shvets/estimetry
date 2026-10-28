import { InvalidValue } from '../shared/domain-error.js';

export interface ThreePointData {
  readonly optimistic: number;
  readonly likely: number;
  readonly pessimistic: number;
}

/** Optimistic, most likely and pessimistic effort in hours. The fact is compared with `likely`. */
export class ThreePointEstimate {
  static readonly ZERO = new ThreePointEstimate(0, 0, 0);

  private constructor(
    readonly optimistic: number,
    readonly likely: number,
    readonly pessimistic: number,
  ) {}

  static of(hours: ThreePointData): ThreePointEstimate {
    for (const [name, value] of Object.entries(hours)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new InvalidValue(`${name} must be a number of hours ≥ 0`);
      }
    }
    if (!(hours.optimistic <= hours.likely && hours.likely <= hours.pessimistic)) {
      throw new InvalidValue('expected optimistic ≤ likely ≤ pessimistic');
    }
    if (hours.likely === 0) {
      throw new InvalidValue('likely must be greater than zero');
    }
    return new ThreePointEstimate(hours.optimistic, hours.likely, hours.pessimistic);
  }

  plus(other: ThreePointEstimate): ThreePointEstimate {
    return new ThreePointEstimate(
      round(this.optimistic + other.optimistic),
      round(this.likely + other.likely),
      round(this.pessimistic + other.pessimistic),
    );
  }

  toData(): ThreePointData {
    return { optimistic: this.optimistic, likely: this.likely, pessimistic: this.pessimistic };
  }
}

/** Sums of quarter hours must not drift into 58.49999. */
function round(hours: number): number {
  return Math.round(hours * 1e6) / 1e6;
}
