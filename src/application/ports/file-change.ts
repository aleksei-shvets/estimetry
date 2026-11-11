/**
 * One step of an install plan. Paths are absolute: a plan touches the project,
 * the tool's personal directory and the user's git excludes alike.
 */
export type FileChange =
  | { readonly path: string; readonly content: string; readonly executable?: boolean }
  | { readonly path: string; readonly remove: true };

/** A file the installer decided not to touch, with the reason shown to the user. */
export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
}

/** What an installer wants done. Nothing is written until every installer has planned without error. */
export interface InstallPlan {
  readonly changes: readonly FileChange[];
  readonly skipped: readonly SkippedFile[];
  readonly warnings: readonly string[];
}

export const EMPTY_PLAN: InstallPlan = { changes: [], skipped: [], warnings: [] };

export function mergePlans(plans: readonly InstallPlan[]): InstallPlan {
  return {
    changes: plans.flatMap((plan) => plan.changes),
    skipped: plans.flatMap((plan) => plan.skipped),
    warnings: plans.flatMap((plan) => plan.warnings),
  };
}

export function isRemoval(change: FileChange): change is { readonly path: string; readonly remove: true } {
  return 'remove' in change;
}
