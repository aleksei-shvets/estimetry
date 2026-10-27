import { InvalidValue } from '../shared/domain-error.js';

const PATTERN = /^T-([1-9]\d*)$/;

/** Short, readable, sequential task id: `T-12`. */
export class TaskId {
  private constructor(readonly number: number) {}

  static parse(value: string): TaskId {
    const match = PATTERN.exec(value.trim());
    if (!match?.[1]) {
      throw new InvalidValue(`invalid task id "${value}", expected T-<number>`);
    }
    return new TaskId(Number(match[1]));
  }

  static fromNumber(number: number): TaskId {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new InvalidValue(`invalid task number: ${number}`);
    }
    return new TaskId(number);
  }

  /** Returns the task number if `value` looks like a task id, otherwise undefined. */
  static tryNumber(value: string): number | undefined {
    const match = PATTERN.exec(value);
    return match?.[1] ? Number(match[1]) : undefined;
  }

  next(): TaskId {
    return new TaskId(this.number + 1);
  }

  equals(other: TaskId): boolean {
    return this.number === other.number;
  }

  toString(): string {
    return `T-${this.number}`;
  }
}
