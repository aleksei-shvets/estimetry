/**
 * The working copy a request comes from: of several working copies of a
 * project, the plan is read in the one containing `near`. Without it, the first
 * registered path of the project.
 */
export interface WorkingCopy {
  readonly near?: string;
}

/** `{ near }` when there is one: options of the ports take no explicit undefined. */
export function nearOf(where: WorkingCopy): { readonly near?: string } {
  return where.near === undefined ? {} : { near: where.near };
}
