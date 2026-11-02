import { InvalidValue } from '../shared/domain-error.js';
import { Duration } from './duration.js';

export const EXTRA_CATEGORIES = ['new-requirement', 'missed-analysis', 'rework', 'environment'] as const;
export type ExtraCategory = (typeof EXTRA_CATEGORIES)[number];

/**
 * How the extra work was settled: `absorbed` — done inside the task;
 * `renegotiated` — agreed with the customer and moved into a new task (`spawned`).
 */
export type ExtraAccounting = 'absorbed' | 'renegotiated';

export interface ExtraData {
  readonly category: ExtraCategory;
  readonly accounting: ExtraAccounting;
  readonly description: string;
  readonly timeMs?: number;
  readonly lines?: number;
  readonly change?: string;
  /** The task the work moved into, for `renegotiated`. */
  readonly spawned?: string;
}

/**
 * Work outside the estimated plan. `time` is the user's own guess of its cost;
 * it does not add to the fact, which comes from intervals.
 */
export class Extra {
  private constructor(private readonly data: ExtraData) {}

  static of(input: {
    readonly category: string;
    readonly description: string;
    readonly time?: Duration;
    readonly lines?: number;
    readonly change?: string;
  }): Extra {
    const category = input.category.trim().toLowerCase();
    if (!isExtraCategory(category)) {
      throw new InvalidValue(`unknown category "${input.category}", expected one of: ${EXTRA_CATEGORIES.join(', ')}`);
    }
    const description = input.description.trim();
    if (description === '') {
      throw new InvalidValue('extra work needs a description');
    }
    if (input.lines !== undefined && !(Number.isSafeInteger(input.lines) && input.lines >= 0)) {
      throw new InvalidValue(`lines must be a non-negative whole number, got ${input.lines}`);
    }
    const change = input.change?.trim();
    if (change === '') {
      throw new InvalidValue('change name must not be empty');
    }
    return new Extra({
      category,
      accounting: 'absorbed',
      description,
      ...(input.time === undefined ? {} : { timeMs: input.time.millis }),
      ...(input.lines === undefined ? {} : { lines: input.lines }),
      ...(change === undefined ? {} : { change }),
    });
  }

  /** Work moved into the task `spawned` by renegotiation (design §3). */
  static renegotiated(input: { readonly category: string; readonly description: string; readonly spawned: string }): Extra {
    const extra = Extra.of({ category: input.category, description: input.description });
    return new Extra({ ...extra.data, accounting: 'renegotiated', spawned: input.spawned });
  }

  static fromData(data: ExtraData): Extra {
    return new Extra({ ...data });
  }

  get accounting(): ExtraAccounting {
    return this.data.accounting;
  }

  get description(): string {
    return this.data.description;
  }

  get category(): ExtraCategory {
    return this.data.category;
  }

  get time(): Duration | undefined {
    return this.data.timeMs === undefined ? undefined : Duration.ofMillis(this.data.timeMs);
  }

  toData(): ExtraData {
    return { ...this.data };
  }
}

export function isExtraCategory(value: unknown): value is ExtraCategory {
  return typeof value === 'string' && (EXTRA_CATEGORIES as readonly string[]).includes(value);
}
