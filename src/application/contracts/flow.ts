import type { ProjectFiles } from '../ports/project-files.js';

/** A development process (OpenSpec, none, …). Plan parsing and change completion come with the hooks. */
export interface Flow {
  readonly id: string;
  readonly title: string;
  /** Whether the project looks like it uses this flow. */
  detect(projectRoot: string, files: ProjectFiles): boolean;
  /** What the user still has to do when the flow is chosen but not set up in the project, e.g. `openspec init`. */
  setupHint?(projectRoot: string, files: ProjectFiles): string | undefined;
}
