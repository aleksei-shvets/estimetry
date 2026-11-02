import type { Estimate } from '../estimate/estimate.js';
import { Duration } from '../measurement/duration.js';
import { Interval } from '../measurement/interval.js';
import { IntervalSet } from '../measurement/interval-set.js';
import type { ManualTime } from '../measurement/manual-time.js';
import { Timestamp } from '../shared/timestamp.js';
import type { ChangeProgress } from './progress-records.js';

/** The plan of one project at a moment: `plan.started`, a checkpoint, or `plan.closing`. */
export interface PlanPoint {
  readonly at: Timestamp;
  readonly project: string;
  readonly changes: readonly ChangeProgress[];
}

/** A change of a project moved into the archive: all its checkboxes are closed then. */
export interface CompletionPoint {
  readonly at: Timestamp;
  readonly project: string;
  readonly change: string;
}

export type PartsFactMode = 'by-checkboxes' | 'no-estimate' | 'no-plan-snapshots';

export interface PartFact {
  /** Whole minutes; null when the part cannot be measured. */
  readonly minutes: number | null;
  readonly reason?: 'no-group';
}

export interface PartFacts {
  readonly mode: PartsFactMode;
  /** In the order of the estimate's parts; empty without an estimate. */
  readonly parts: readonly PartFact[];
  /** Minutes of the fact that no part got. */
  readonly unattributed: number;
}

export interface PartFactsInput {
  readonly estimate: Estimate | undefined;
  readonly startedAt: Timestamp;
  readonly closedAt: Timestamp;
  readonly points: readonly PlanPoint[];
  readonly completions: readonly CompletionPoint[];
  /** Intervals measured from hooks, without manual time. */
  readonly measured: { readonly agent: IntervalSet; readonly user: IntervalSet };
  readonly manual: readonly ManualTime[];
}

/**
 * The fact of a task split by parts of its estimate (design §8, task-cards
 * spec): the time between two snapshots of the plan goes to the groups whose
 * checkboxes closed in it, in proportion to how many closed. Time with no
 * closing waits in a pool for the next closing; what is left goes to
 * `unattributed`. The sum of all parts and `unattributed` is the fact.
 */
export function partFacts(input: PartFactsInput): PartFacts {
  const { agent, user } = timedSets(input.measured, input.manual, () => true);
  const total = agent.total.plus(user.total).plus(untimed(input.manual, () => true));
  const totalMinutes = Math.round(total.minutes);
  const estimate = input.estimate;
  if (estimate === undefined) {
    return { mode: 'no-estimate', parts: [], unattributed: totalMinutes };
  }
  const nullParts = estimate.parts.map((part): PartFact =>
    part.group === undefined ? { minutes: null, reason: 'no-group' } : { minutes: null },
  );
  const points = input.points
    .map((point) => ({ ...point, millis: clamp(point.at, input) }))
    .sort((a, b) => a.millis - b.millis);
  if (points.length === 0) {
    return { mode: 'no-plan-snapshots', parts: nullParts, unattributed: totalMinutes };
  }

  const groups = new Set(estimate.parts.flatMap((part) => (part.group === undefined ? [] : [part.group])));
  const grouped = estimate.parts.filter((part) => part.group !== undefined);
  // Manual time recorded for a grouped part goes to it; the rest of the fact is sliced by time.
  const ownManual = (record: ManualTime): boolean =>
    record.part !== undefined && grouped.some((part) => part.id === record.part);
  const pooled = timedSets(input.measured, input.manual, (record) => !ownManual(record));
  const byGroup = new Map<string, number>();
  const direct = new Map<string, number>();
  const ownMillis = total.millis - pooled.agent.total.millis - pooled.user.total.millis - untimed(input.manual, (r) => !ownManual(r)).millis;
  distributeOwnManual(input.manual.filter(ownManual), ownMillis, direct);

  const steps = timeline(points, input.completions.map((c) => ({ ...c, millis: clamp(c.at, input) })));
  const last = new Map<string, number>();
  const seenProject = new Set<string>();
  let pool = 0;
  let cursor = input.startedAt.toMillis();
  for (const step of steps) {
    pool += sliceMillis(pooled, cursor, step.millis);
    cursor = Math.max(cursor, step.millis);
    const closed = new Map<string, number>();
    for (const update of step.updates) {
      const key = `${update.project}\u0000${update.change}`;
      // The first snapshot of a project is the base: boxes closed before it are not the task's.
      // A change that appears later in a project already seen starts from zero.
      const previous = last.get(key) ?? (seenProject.has(update.project) ? 0 : undefined);
      const done = update.done;
      if (previous !== undefined && done > previous && groups.has(update.change)) {
        closed.set(update.change, (closed.get(update.change) ?? 0) + done - previous);
      }
      last.set(key, Math.max(previous ?? 0, done));
    }
    for (const update of step.updates) {
      seenProject.add(update.project);
    }
    const count = [...closed.values()].reduce((a, b) => a + b, 0);
    if (count > 0 && pool > 0) {
      for (const [group, n] of closed) {
        byGroup.set(group, (byGroup.get(group) ?? 0) + (pool * n) / count);
      }
      pool = 0;
    }
  }
  pool += sliceMillis(pooled, cursor, input.closedAt.toMillis());
  pool += untimed(input.manual, (record) => !ownManual(record)).millis;

  // A group's time is shared by its parts in proportion to their most likely hours.
  const exact = estimate.parts.map((part) => {
    if (part.group === undefined) {
      return 0;
    }
    const siblings = grouped.filter((other) => other.group === part.group);
    const weight = siblings.reduce((sum, other) => sum + other.hours.likely, 0);
    const share = weight === 0 ? 1 / siblings.length : part.hours.likely / weight;
    return (byGroup.get(part.group) ?? 0) * share + (direct.get(part.id) ?? 0);
  });
  const minutes = largestRemainder([...exact, pool].map((ms) => ms / 60_000), totalMinutes);
  return {
    mode: 'by-checkboxes',
    parts: estimate.parts.map((part, i): PartFact =>
      part.group === undefined ? { minutes: null, reason: 'no-group' } : { minutes: minutes[i] ?? 0 },
    ),
    unattributed: minutes.at(-1) ?? 0,
  };
}

interface Update {
  readonly project: string;
  readonly change: string;
  readonly done: number;
}

interface Step {
  readonly millis: number;
  readonly updates: readonly Update[];
}

/** Snapshots and completions in time order; a completion closes all boxes of its change as last known. */
function timeline(
  points: readonly (PlanPoint & { millis: number })[],
  completions: readonly (CompletionPoint & { millis: number })[],
): Step[] {
  const totals = new Map<string, number>();
  const events = [
    ...points.map((point) => ({ millis: point.millis, order: 0, point, completion: undefined })),
    ...completions.map((completion) => ({ millis: completion.millis, order: 1, point: undefined, completion })),
  ].sort((a, b) => a.millis - b.millis || a.order - b.order);
  const steps: Step[] = [];
  for (const event of events) {
    const updates: Update[] = [];
    if (event.point) {
      for (const change of event.point.changes) {
        const done = change.archived ? change.total : change.done;
        totals.set(`${event.point.project}\u0000${change.change}`, change.total);
        updates.push({ project: event.point.project, change: change.change, done });
      }
    } else if (event.completion) {
      const total = totals.get(`${event.completion.project}\u0000${event.completion.change}`);
      if (total !== undefined) {
        updates.push({ project: event.completion.project, change: event.completion.change, done: total });
      }
    }
    steps.push({ millis: event.millis, updates });
  }
  return steps;
}

function timedSets(
  measured: { readonly agent: IntervalSet; readonly user: IntervalSet },
  manual: readonly ManualTime[],
  include: (record: ManualTime) => boolean,
): { agent: IntervalSet; user: IntervalSet } {
  const timed = (kind: 'agent' | 'user') =>
    IntervalSet.of(
      manual
        .filter((record) => record.kind === kind && record.at !== undefined && include(record))
        .map((record) => Interval.endingAt(record.at as Timestamp, record.duration)),
    );
  return { agent: measured.agent.union(timed('agent')), user: measured.user.union(timed('user')) };
}

function untimed(manual: readonly ManualTime[], include: (record: ManualTime) => boolean): Duration {
  return Duration.sum(manual.filter((record) => record.at === undefined && include(record)).map((record) => record.duration));
}

/** What manual time of the parts adds to the fact goes to the parts, in proportion to their records. */
function distributeOwnManual(records: readonly ManualTime[], millis: number, direct: Map<string, number>): void {
  const sum = records.reduce((total, record) => total + record.duration.millis, 0);
  if (sum === 0 || millis <= 0) {
    return;
  }
  for (const record of records) {
    const part = record.part as string;
    direct.set(part, (direct.get(part) ?? 0) + (millis * record.duration.millis) / sum);
  }
}

function sliceMillis(sets: { agent: IntervalSet; user: IntervalSet }, from: number, to: number): number {
  if (to <= from) {
    return 0;
  }
  const start = Timestamp.fromMillis(from);
  const end = Timestamp.fromMillis(to);
  return sets.agent.within(start, end).total.millis + sets.user.within(start, end).total.millis;
}

function clamp(at: Timestamp, input: { readonly startedAt: Timestamp; readonly closedAt: Timestamp }): number {
  return Math.min(Math.max(at.toMillis(), input.startedAt.toMillis()), input.closedAt.toMillis());
}

/**
 * Whole numbers that sum to `total`, each the floor of its value plus one for
 * the largest remainders: the parts and `unattributed` always add up to the fact.
 */
export function largestRemainder(values: readonly number[], total: number): number[] {
  const floors = values.map((value) => Math.floor(Math.max(0, value)));
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((value, i) => ({ i, remainder: Math.max(0, value) - (floors[i] ?? 0) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const result = [...floors];
  for (let k = 0; rest > 0 && order.length > 0; k = (k + 1) % order.length, rest--) {
    const index = (order[k] as { i: number }).i;
    result[index] = (result[index] ?? 0) + 1;
  }
  // Rounding the total may leave it below the floors; take the excess from the smallest remainders.
  for (let k = order.length - 1, guard = 0; rest < 0 && order.length > 0 && guard < 10 * order.length; guard++) {
    const index = (order[k] as { i: number }).i;
    if ((result[index] ?? 0) > 0) {
      result[index] = (result[index] ?? 0) - 1;
      rest++;
    }
    k = (k - 1 + order.length) % order.length;
  }
  return result;
}
