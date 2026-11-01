import type { ChangeProgress } from '../../domain/progress/progress-records.js';
import type { CalendarDate } from '../../domain/shared/calendar-date.js';
import type { ProjectFiles } from '../ports/project-files.js';

/** An archive directory of a change: what the hook receiver looks at, without reading its tasks. */
export interface ArchivedChange {
  readonly change: string;
  readonly archivedOn: CalendarDate;
  /** Name of the directory in the archive, e.g. `2026-11-02-plan-progress`. */
  readonly directory: string;
  /** Absolute path of the directory. */
  readonly path: string;
}

/** A development process (OpenSpec, none, …). Plan parsing and change completion come with the hooks. */
export interface Flow {
  readonly id: string;
  readonly title: string;
  /** Whether the project looks like it uses this flow. */
  detect(projectRoot: string, files: ProjectFiles): boolean;
  /** What the user still has to do when the flow is chosen but not set up in the project, e.g. `openspec init`. */
  setupHint?(projectRoot: string, files: ProjectFiles): string | undefined;
  /**
   * Changes of the plan with their checkboxes; empty for a flow without a plan.
   * Archives dated before `archivedSince` are listed with no checkboxes, unread: only their names matter then.
   */
  plan(projectRoot: string, files: ProjectFiles, options?: { readonly archivedSince?: CalendarDate }): readonly ChangeProgress[];
  /** Archived changes from one listing of the archive, without reading their tasks; empty without an archive. */
  archived(projectRoot: string, files: ProjectFiles): readonly ArchivedChange[];
}
