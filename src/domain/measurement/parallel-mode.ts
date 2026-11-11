import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';

export interface ParallelModeChangeData {
  readonly reason?: string;
  readonly agents?: number;
  readonly parts: readonly string[];
  /** Fact divided by the most likely estimate when the mode was switched on. */
  readonly budgetShare?: number;
  /** Share of the plan done at that moment (design §3); compared with the budget share it shows whether work lagged. */
  readonly planShare?: number;
}

/** Why and how the user switched to working with several agents in parallel. */
export class ParallelModeChange {
  private constructor(private readonly data: ParallelModeChangeData) {}

  static of(input: {
    readonly reason?: string;
    readonly agents?: number;
    readonly parts?: readonly string[];
    readonly budgetShare?: number;
    readonly planShare?: number;
  }): ParallelModeChange {
    const reason = input.reason?.trim();
    if (input.agents !== undefined && !(Number.isSafeInteger(input.agents) && input.agents >= 1)) {
      throw new InvalidValue(`number of agents must be a whole number of at least 1, got ${input.agents}`);
    }
    if (input.budgetShare !== undefined && !(Number.isFinite(input.budgetShare) && input.budgetShare >= 0)) {
      throw new InvalidValue(`budget share must be a non-negative number, got ${input.budgetShare}`);
    }
    if (input.planShare !== undefined && !(Number.isFinite(input.planShare) && input.planShare >= 0 && input.planShare <= 1)) {
      throw new InvalidValue(`plan share must be between 0 and 1, got ${input.planShare}`);
    }
    const parts = [...new Set((input.parts ?? []).map((part) => part.trim()).filter((part) => part !== ''))];
    return new ParallelModeChange({
      ...(reason ? { reason } : {}),
      ...(input.agents === undefined ? {} : { agents: input.agents }),
      parts,
      ...(input.budgetShare === undefined ? {} : { budgetShare: input.budgetShare }),
      ...(input.planShare === undefined ? {} : { planShare: input.planShare }),
    });
  }

  static fromData(data: ParallelModeChangeData): ParallelModeChange {
    return new ParallelModeChange({ ...data, parts: [...data.parts] });
  }

  get parts(): readonly string[] {
    return this.data.parts;
  }

  get agents(): number | undefined {
    return this.data.agents;
  }

  toData(): ParallelModeChangeData {
    return { ...this.data, parts: [...this.data.parts] };
  }
}

/** One stretch of parallel mode as the task remembers it. */
export interface ParallelPeriod {
  readonly enabledAt: Timestamp;
  readonly disabledAt?: Timestamp;
  readonly change: ParallelModeChangeData;
}

/** A stretch of parallel mode as the snapshot keeps it. */
export interface ParallelPeriodData {
  readonly enabledAt: string;
  readonly disabledAt?: string;
  readonly change: ParallelModeChangeData;
}

export function parallelPeriodOf(data: ParallelPeriodData): ParallelPeriod {
  return {
    enabledAt: Timestamp.parse(data.enabledAt),
    ...(data.disabledAt === undefined ? {} : { disabledAt: Timestamp.parse(data.disabledAt) }),
    change: data.change,
  };
}

export function parallelPeriodData(period: ParallelPeriod): ParallelPeriodData {
  // The order of the keys is that of snapshots written before: the end is added to a period that has begun.
  return {
    enabledAt: period.enabledAt.toISOString(),
    change: period.change,
    ...(period.disabledAt === undefined ? {} : { disabledAt: period.disabledAt.toISOString() }),
  };
}
