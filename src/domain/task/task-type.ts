import { UnknownTaskType } from './task-errors.js';

/** Built-in task types (design §3); users extend the list in config. */
export const DEFAULT_TASK_TYPES = [
  'feature',
  'integration',
  'bugfix',
  'refactor',
  'infra',
  'migration',
  'research',
] as const;

export const DEFAULT_TASK_TYPE = 'feature';

export class TaskType {
  private constructor(readonly value: string) {}

  /** Validates `value` against the catalog of allowed types. */
  static of(value: string, allowed: readonly string[]): TaskType {
    const normalized = value.trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new UnknownTaskType(value, allowed);
    }
    return new TaskType(normalized);
  }

  /** Restores a type that was valid when it was recorded, without re-validating against today's catalog. */
  static restore(value: string): TaskType {
    return new TaskType(value);
  }

  toString(): string {
    return this.value;
  }
}
