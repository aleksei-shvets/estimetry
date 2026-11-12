import type { ProjectId } from '../../domain/project/project-id.js';
import type { ChangeProgress } from '../../domain/progress/progress-records.js';
import type { CalendarDate } from '../../domain/shared/calendar-date.js';

/** An archive directory of a change: what the hook receiver looks at, without reading its tasks. */
export interface ArchivedChange {
  readonly change: string;
  readonly archivedOn: CalendarDate;
  /** Name of the directory in the archive, e.g. `2026-11-02-plan-progress`. */
  readonly directory: string;
  /** Absolute path of the directory. */
  readonly path: string;
}

/** Why a project of a task has no plan here. */
export type PlanUnavailable = 'flow-none' | 'unknown-flow' | 'no-config' | 'not-on-this-machine';

export interface ProjectPlanReading {
  readonly project: ProjectId;
  readonly root?: string;
  /** The flow named in the project's config, also when it is unknown. */
  readonly flow?: string;
  readonly changes?: readonly ChangeProgress[];
  readonly archived?: readonly ArchivedChange[];
  readonly unavailable?: PlanUnavailable;
}

export interface PlanReadOptions {
  /**
   * A directory the work happens in: of several working copies of a project
   * (worktrees, clones) the one containing it is read, not the first registered.
   */
  readonly near?: string;
}

/** Plans of the flows of projects (from `.estimetry/config.yaml`), on the paths this machine has. */
export interface ProjectPlans {
  /** The plan of one working copy, for checkpoints; undefined when it cannot be read. */
  plan(projectRoot: string): readonly ChangeProgress[] | undefined;
  /** Plans of the projects of a task, with their archives; archives before `archivedSince` are not read. */
  plans(projects: readonly ProjectId[], options?: PlanReadOptions & { readonly archivedSince?: CalendarDate }): ProjectPlanReading[];
  /** Only the archives: the hot path of a hook, one directory listing per project. */
  archives(projects: readonly ProjectId[], options?: PlanReadOptions): ProjectPlanReading[];
}
