import { CardsTooNew } from '../../domain/card/card-errors.js';

/** Runs derived steps; a failure becomes a warning, since `emt rebuild` can repeat it. */
export function derived(steps: readonly (readonly [string, () => unknown])[]): string[] {
  const warnings: string[] = [];
  for (const [what, run] of steps) {
    try {
      run();
    } catch (error) {
      warnings.push(derivedWarning(what, error));
    }
  }
  return warnings;
}

/** Rebuilding repeats a failed step, except when cards of a newer estimetry block it: then estimetry needs an update. */
export function derivedWarning(what: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof CardsTooNew ? `${what} failed (${message})` : `${what} failed (${message}); run \`emt rebuild\``;
}
