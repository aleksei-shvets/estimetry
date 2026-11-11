import { join } from 'node:path';
import type { ProjectFiles } from '../../../application/ports/project-files.js';
import type { ArchivedChange } from '../../../application/ports/project-plans.js';
import type { ChangeProgress } from '../../../domain/progress/progress-records.js';
import { CalendarDate } from '../../../domain/shared/calendar-date.js';

const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s/;
const FENCE = /^\s*```/;
const ARCHIVED = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/** Checked and all checkboxes of a `tasks.md`, outside code blocks. */
export function countCheckboxes(text: string): { done: number; total: number } {
  let inCode = false;
  let done = 0;
  let total = 0;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inCode = !inCode;
      continue;
    }
    const box = inCode ? null : CHECKBOX.exec(line);
    if (box) {
      total += 1;
      if (box[1] !== ' ') {
        done += 1;
      }
    }
  }
  return { done, total };
}

/** Archived changes from one listing of `openspec/changes/archive/`; the date is the part before the name. */
export function openSpecArchived(projectRoot: string, files: ProjectFiles): ArchivedChange[] {
  const archiveDir = join(projectRoot, 'openspec', 'changes', 'archive');
  const archived: ArchivedChange[] = [];
  for (const name of files.list(archiveDir)) {
    const match = ARCHIVED.exec(name);
    const archivedOn = match ? dateOf(match[1] as string) : undefined;
    if (match && archivedOn) {
      archived.push({ change: match[2] as string, archivedOn, directory: name, path: join(archiveDir, name) });
    }
  }
  return archived;
}

/**
 * Active changes in `openspec/changes/<name>/` (also without a `tasks.md`) and
 * archived ones; an active change wins over an archived one of the same name,
 * and of several archives of one name the latest. A `tasks.md` that cannot be
 * read counts as none. Archives before `archivedSince` keep their name and date, unread.
 */
export function openSpecPlan(
  projectRoot: string,
  files: ProjectFiles,
  options: { readonly archivedSince?: CalendarDate } = {},
): ChangeProgress[] {
  const changesDir = join(projectRoot, 'openspec', 'changes');
  const byName = new Map<string, ChangeProgress>();
  for (const name of files.list(changesDir)) {
    if (name !== 'archive' && !name.startsWith('.')) {
      byName.set(name, { change: name, archived: false, ...count(files, join(changesDir, name, 'tasks.md')) });
    }
  }
  const archived = openSpecArchived(projectRoot, files).sort((a, b) => b.archivedOn.compare(a.archivedOn));
  for (const change of archived) {
    if (!byName.has(change.change)) {
      const old = options.archivedSince !== undefined && change.archivedOn.isBefore(options.archivedSince);
      byName.set(change.change, {
        change: change.change,
        archived: true,
        archivedOn: change.archivedOn.value,
        ...(old ? { done: 0, total: 0 } : count(files, join(change.path, 'tasks.md'))),
        // Only for the plan of a task: a change rolled back and archived again the same day differs by this.
        ...(options.archivedSince === undefined || old ? {} : changedAt(files, change.path)),
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.change.localeCompare(b.change));
}

function changedAt(files: ProjectFiles, path: string): { changedAt?: number } {
  const value = files.changedAt(path);
  return value === undefined || value <= 0 ? {} : { changedAt: value };
}

function count(files: ProjectFiles, path: string): { done: number; total: number } {
  let text: string | undefined;
  try {
    text = files.read(path);
  } catch {
    text = undefined;
  }
  return text === undefined ? { done: 0, total: 0 } : countCheckboxes(text);
}

function dateOf(value: string): CalendarDate | undefined {
  try {
    return CalendarDate.parse(value);
  } catch {
    return undefined; // `2026-02-30-x` is a name, not an archive
  }
}
