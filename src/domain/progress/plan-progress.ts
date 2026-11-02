import type { Estimate } from '../estimate/estimate.js';
import type { EstimatePart } from '../estimate/estimate-part.js';
import type { PlannedChange, TaskPlan } from './task-plan.js';

export type PlanMode = 'changes' | 'checkboxes';

export interface PlanProgress {
  /** Whole percent, rounded down: 100 only when everything is done. */
  readonly done: number;
  readonly mode: PlanMode;
  /** Hours of the parts with a group, and of the whole estimate; absent when counted by checkboxes. */
  readonly groupedHours?: number;
  readonly estimateHours?: number;
  readonly notStarted: readonly string[];
  readonly possibleTypos: readonly { readonly group: string; readonly similar: string }[];
  readonly archivedBeforeStart: readonly string[];
  readonly archivedBeforeRevision: readonly string[];
}

/**
 * "The plan is N% done" (design §8, plan-progress spec). With groups in the
 * estimate the parts are weighted by their most likely hours; without them
 * the checkboxes of the plan count. Undefined when there is nothing to count.
 */
export function planProgress(estimate: Estimate | undefined, plan: TaskPlan): PlanProgress | undefined {
  const grouped = (estimate?.parts ?? []).filter((part) => part.group !== undefined);
  if (grouped.length > 0 && estimate) {
    return byChanges(grouped, estimate.total.likely, plan);
  }
  const total = plan.changes.reduce((sum, change) => sum + change.total, 0);
  if (total === 0) {
    return undefined;
  }
  const done = plan.changes.reduce((sum, change) => sum + (change.archived ? change.total : change.done), 0);
  return { done: percent(done / total), mode: 'checkboxes', notStarted: [], possibleTypos: [], archivedBeforeStart: [], archivedBeforeRevision: [] };
}

function byChanges(
  parts: readonly EstimatePart[],
  estimateHours: number,
  plan: TaskPlan,
): PlanProgress {
  const missing = new Set<string>();
  let weighted = 0;
  let groupedHours = 0;
  for (const part of parts) {
    const group = part.group as string;
    const changes = plan.changes.filter((change) => change.change === group);
    groupedHours += part.hours.likely;
    if (changes.length === 0) {
      missing.add(group);
      continue;
    }
    weighted += part.hours.likely * progressOf(changes);
  }
  // A change that is a group of its own is no typo of another group: `auth-v2` before it exists is not `auth-v1`.
  const groups = new Set(parts.map((part) => part.group as string));
  const names = [...new Set(plan.changes.map((change) => change.change))].filter((name) => !groups.has(name));
  const notStarted: string[] = [];
  const possibleTypos: { group: string; similar: string }[] = [];
  const archivedBeforeStart: string[] = [];
  const archivedBeforeRevision: string[] = [];
  for (const group of missing) {
    const similar = names.find((name) => levenshtein(name, group) <= typoDistance(group));
    if (plan.archivedBeforeRevision.has(group)) {
      archivedBeforeRevision.push(group);
    } else if (plan.archivedBeforeStart.has(group)) {
      archivedBeforeStart.push(group);
    } else if (similar !== undefined) {
      possibleTypos.push({ group, similar });
    } else {
      notStarted.push(group);
    }
  }
  return {
    done: groupedHours === 0 ? 0 : percent(weighted / groupedHours),
    mode: 'changes',
    groupedHours,
    estimateHours,
    notStarted,
    possibleTypos,
    archivedBeforeStart,
    archivedBeforeRevision,
  };
}

/** An archived change is done, even with unticked items; several changes of a group count together. */
function progressOf(changes: readonly PlannedChange[]): number {
  if (changes.every((change) => change.archived)) {
    return 1;
  }
  const total = changes.reduce((sum, change) => sum + change.total, 0);
  const done = changes.reduce((sum, change) => sum + (change.archived ? change.total : change.done), 0);
  return total === 0 ? 0 : done / total;
}

/** Down, with room for floating point: 29 of 50 is 58, not 57.99… → 57. */
function percent(ratio: number): number {
  return Math.min(100, Math.floor(ratio * 100 + 1e-9));
}

/** At most 2 edits, and at most a third of the name: `ui` and `db` are different names, not a typo. */
function typoDistance(name: string): number {
  return Math.min(2, Math.floor(name.length / 3));
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] as number;
      row[j] = Math.min((row[j] as number) + 1, (row[j - 1] as number) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] as number;
}
