import { InvalidValue } from '../shared/domain-error.js';

/** Expected lines of code as `[min, max]`. */
export type LineRange = readonly [number, number];

export interface CodeVolumeData {
  readonly production?: LineRange;
  readonly tests?: LineRange;
}

/** Forecast of code volume; a self-check only, the estimate is never derived from it. */
export class CodeVolume {
  private constructor(private readonly data: CodeVolumeData) {}

  static of(input: { readonly production?: readonly number[]; readonly tests?: readonly number[] }): CodeVolume {
    return new CodeVolume({
      ...(input.production === undefined ? {} : { production: range(input.production, 'production') }),
      ...(input.tests === undefined ? {} : { tests: range(input.tests, 'tests') }),
    });
  }

  toData(): CodeVolumeData {
    return { ...this.data };
  }
}

function range(value: readonly number[], name: string): LineRange {
  const [min, max] = value;
  if (
    value.length !== 2 ||
    min === undefined ||
    max === undefined ||
    ![min, max].every((n) => Number.isSafeInteger(n) && n >= 0)
  ) {
    throw new InvalidValue(`${name} must be [min, max] in whole lines`);
  }
  if (min > max) {
    throw new InvalidValue(`${name}: expected min ≤ max`);
  }
  return [min, max];
}
