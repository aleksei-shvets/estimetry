import { ConcurrencyConflict } from '../../domain/task/task-errors.js';

/**
 * Runs a load-modify-save operation and repeats it once if another process
 * saved the same aggregate in between. A second conflict is reported.
 */
export function retryOnConflict<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ConcurrencyConflict) {
      return operation();
    }
    throw error;
  }
}
