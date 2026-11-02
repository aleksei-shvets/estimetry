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

/** Records made during work need a started task. */
export class TaskNotStarted extends DomainError {
  readonly code = 'task-not-started';

  constructor(taskId: string, status: string) {
    super(`${taskId} is ${status}, not in progress; start it first with \`emt start ${taskId}\``);
  }
}

/** Once work has started, the estimate is the plan the fact is compared with. */
export class EstimateLocked extends DomainError {
  readonly code = 'estimate-locked';

  constructor(taskId: string, status: string) {
    super(`${taskId} is ${status}: its estimate is already the plan the fact is compared with and cannot change`);
  }
}

/** A closed task takes no more records of work; reopening it is the way back. */
export class TaskClosed extends DomainError {
  readonly code = 'task-closed';

  constructor(taskId: string) {
    super(`${taskId} is closed; reopen it first with \`emt reopen ${taskId}\``);
  }
}

/** A retro is about what happened, so it needs the task closed. */
export class TaskNotClosed extends DomainError {
  readonly code = 'task-not-closed';

  constructor(taskId: string, status: string) {
    super(`${taskId} is ${status}; close it first with \`emt close ${taskId}\``);
  }
}

export class ParallelModeConflict extends DomainError {
  readonly code = 'parallel-mode-conflict';

  constructor(taskId: string, enabled: boolean) {
    super(`parallel mode of ${taskId} is already ${enabled ? 'on' : 'off'}`);
  }
}

export class UnknownEstimatePart extends DomainError {
  readonly code = 'unknown-estimate-part';

  constructor(parts: readonly string[], known: readonly string[]) {
    super(
      known.length === 0
        ? `unknown estimate part ${parts.join(', ')}: the task has no estimate`
        : `unknown estimate part ${parts.join(', ')}, expected one of: ${known.join(', ')}`,
    );
  }
}
