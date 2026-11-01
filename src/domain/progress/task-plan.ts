import { CalendarDate } from '../shared/calendar-date.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { ChangeProgress } from './progress-records.js';

/** The plan of one project of a task, as its flow reads it. */
export interface ProjectPlan {
  readonly project: string;
  readonly changes: readonly ChangeProgress[];
}

/** A change of the task's plan; a change is a project and a name. */
export interface PlannedChange extends ChangeProgress {
  readonly project: string;
}

export interface TaskPlan {
  readonly changes: readonly PlannedChange[];
  /** Names archived in some project of the task, but before its window. */
  readonly archivedBeforeStart: ReadonlySet<string>;
}

/**
 * The changes that belong to a task (plan-progress spec): every active change,
 * and archived ones dated no earlier than the day before the start in UTC — the
 * date of an archive directory is local. An active change wins over an archived
 * one of the same name; of several archives of one name the latest wins.
 */
export function taskPlan(projects: readonly ProjectPlan[], startedAt: Timestamp): TaskPlan {
  const windowStart = CalendarDate.of(startedAt).minusDays(1);
  const changes: PlannedChange[] = [];
  const archivedBeforeStart = new Set<string>();
  for (const { project, changes: found } of projects) {
    const byName = new Map<string, ChangeProgress>();
    for (const change of found) {
      if (change.archived && change.archivedOn !== undefined && CalendarDate.parse(change.archivedOn).isBefore(windowStart)) {
        archivedBeforeStart.add(change.change);
        continue;
      }
      const current = byName.get(change.change);
      if (current === undefined || wins(change, current)) {
        byName.set(change.change, change);
      }
    }
    for (const change of byName.values()) {
      changes.push({ ...change, project });
    }
  }
  for (const change of changes) {
    archivedBeforeStart.delete(change.change);
  }
  return { changes, archivedBeforeStart };
}

function wins(candidate: ChangeProgress, current: ChangeProgress): boolean {
  if (candidate.archived !== current.archived) {
    return !candidate.archived; // the active one
  }
  return (candidate.archivedOn ?? '') > (current.archivedOn ?? '');
}
