import { CalendarDate } from '../shared/calendar-date.js';
import { Timestamp } from '../shared/timestamp.js';

/**
 * Archived changes a revision with `exclude` took out of the plan of a task
 * (estimate-revision spec). `read` names, per such revision, the projects whose
 * archive was listed; for any other project the archive counts from the day of the revision.
 */
export interface PlanExclusions {
  readonly archives: readonly {
    readonly project: string;
    readonly change: string;
    readonly archivedOn: string;
    readonly changedAt?: number;
  }[];
  readonly read: readonly { readonly at: string; readonly projects: readonly string[] }[];
}

export const NO_EXCLUSIONS: PlanExclusions = { archives: [], read: [] };

/** Directories of one name and date differ by this much at least when archived again. */
const SAME_DIRECTORY_MS = 1_000;

/**
 * Whether an archived change of a project is out of the plan. `changedAt` is
 * when its directory last changed: a change rolled back and archived again
 * the same day has the same name and date, but a later time — it counts again.
 */
export function isExcluded(exclusions: PlanExclusions, project: string, change: string, archivedOn: string, changedAt?: number): boolean {
  const listed = exclusions.archives.some(
    (a) =>
      a.project === project &&
      a.change === change &&
      a.archivedOn === archivedOn &&
      (changedAt === undefined || a.changedAt === undefined || changedAt <= a.changedAt + SAME_DIRECTORY_MS),
  );
  if (listed) {
    return true;
  }
  // A project not listed at a revision: its archive counts from the day before that revision, like from a start.
  return exclusions.read.some(
    (revision) =>
      !revision.projects.includes(project) &&
      CalendarDate.parse(archivedOn).isBefore(CalendarDate.of(Timestamp.parse(revision.at)).minusDays(1)),
  );
}

/** Exclusions of the revisions of a task, as its snapshot keeps them. */
export function exclusionsOf(
  revisions: readonly {
    readonly at: string;
    readonly spent?: string;
    readonly excluded?: readonly {
      readonly project: string;
      readonly archives: readonly { readonly change: string; readonly archivedOn: string; readonly changedAt?: number }[];
    }[];
  }[],
): PlanExclusions {
  const excluding = revisions.filter((revision) => revision.spent === 'exclude');
  return {
    archives: excluding.flatMap((revision) =>
      (revision.excluded ?? []).flatMap((project) => project.archives.map((archive) => ({ project: project.project, ...archive }))),
    ),
    read: excluding.map((revision) => ({ at: revision.at, projects: (revision.excluded ?? []).map((project) => project.project) })),
  };
}

/** For a recorded completion: its directory names the date it was archived on (`2026-11-02-auth`). */
export function isExcludedDirectory(
  exclusions: PlanExclusions,
  project: string,
  change: string,
  directory: string,
  changedAt?: number,
): boolean {
  const date = /^(\d{4}-\d{2}-\d{2})-/.exec(directory)?.[1];
  return date !== undefined && isExcluded(exclusions, project, change, date, changedAt);
}
