import { DomainError } from '../shared/domain-error.js';

export class TaskNotFound extends DomainError {
  readonly code = 'task-not-found';

  constructor(readonly taskId: string) {
    super(`task ${taskId} not found`);
  }
}

export class InvalidTransition extends DomainError {
  readonly code = 'invalid-transition';

  constructor(taskId: string, status: string, action: string) {
    super(`cannot ${action} task ${taskId}: it is ${status}`);
  }
}

export class AmbiguousTask extends DomainError {
  readonly code = 'ambiguous-task';

  constructor(
    readonly reason: string,
    readonly candidates: readonly string[],
  ) {
    super(candidates.length === 0 ? reason : `${reason}: ${candidates.join(', ')}`);
  }
}

export class UnknownTaskType extends DomainError {
  readonly code = 'unknown-task-type';

  constructor(value: string, allowed: readonly string[]) {
    super(`unknown task type "${value}", expected one of: ${allowed.join(', ')}`);
  }
}

/** Someone else saved the task after we loaded it. */
export class ConcurrencyConflict extends DomainError {
  readonly code = 'concurrency-conflict';

  constructor(taskId: string, expected: number, actual: number) {
    super(`task ${taskId} was changed concurrently (expected version ${expected}, found ${actual})`);
  }
}
