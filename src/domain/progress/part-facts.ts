import type { Estimate } from '../estimate/estimate.js';
import type { EstimatePart } from '../estimate/estimate-part.js';
import { Duration } from '../measurement/duration.js';
import { IntervalSet } from '../measurement/interval-set.js';
import type { ManualTime } from '../measurement/manual-time.js';
import type { Timestamp } from '../shared/timestamp.js';
import { isExcluded, isExcludedDirectory, NO_EXCLUSIONS, type PlanExclusions } from './plan-exclusions.js';
import { CheckboxWalk, type Step, type Update } from './checkbox-walk.js';
import type { ChangeProgress } from './progress-records.js';

/** The plan of one project at a moment: `plan.started`, a checkpoint, or `plan.closing`. */
export interface PlanPoint {
  readonly at: Timestamp;
  readonly project: string;
  readonly changes: readonly ChangeProgress[];
  /** Id of the revision whose `plan.revised` this snapshot is. */
  readonly revision?: string;
}

/** A change of a project moved into the archive: all its checkboxes are closed then. */
export interface CompletionPoint {
  readonly at: Timestamp;
  readonly project: string;
  readonly change: string;
  /** Name of the archive directory, when the completion recorded it. */
  readonly directory?: string;
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
  /** Counted minutes before the last revision: they belong to no part of the current estimate. */
  readonly beforeRevision: number;
}

/** The last revision of the estimate, as the split by parts needs it. */
export interface RevisionBoundary {
  readonly id: string;
  readonly at: Timestamp;
  /** Archived changes taken out of the plan by revisions with `exclude`. */
  readonly exclusions: PlanExclusions;
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
  /** When each manual record was made, in the order of `manual`; needed with a revision. */
  readonly manualRecordedAt?: readonly (Timestamp | undefined)[];
  /** Windows of lost work: not part of the counted fact. */
  readonly lost?: IntervalSet;
  readonly revision?: RevisionBoundary;
}

/**
 * The fact of a task split by parts of its estimate (design §8, task-cards
 * spec): the time between two snapshots of the plan goes to the groups whose
 * checkboxes closed in it, in proportion to how many closed. Time with no
 * closing waits in a pool for the next closing; what is left goes to
 * `unattributed`. The sum of all parts and `unattributed` is the fact.
 */
export function partFacts(input: PartFactsInput): PartFacts {
  const lost = input.lost ?? IntervalSet.EMPTY;
  const revision = input.revision;
  const records = input.manual.map((record, i) => ({ record, recordedAt: input.manualRecordedAt?.[i] }));
  const { agent, user } = timedSets(input.measured, records, lost, () => true);
  const total = agent.total.plus(user.total).plus(untimed(records, () => true));
  const totalMinutes = Math.round(total.minutes);
  const estimate = input.estimate;
  if (estimate === undefined) {
    return { mode: 'no-estimate', parts: [], unattributed: totalMinutes, beforeRevision: 0 };
  }
  const nullParts = estimate.parts.map((part): PartFact =>
    part.group === undefined ? { minutes: null, reason: 'no-group' } : { minutes: null },
  );
  const boundary = revision === undefined ? undefined : clamp(revision.at, input);
  const exclusions = revision?.exclusions ?? NO_EXCLUSIONS;
  const points = planPoints(input, boundary, exclusions);
  const afterBoundary = boundary === undefined ? points : points.filter((point) => point.millis >= boundary);
  if (afterBoundary.length === 0 && revision === undefined) {
    return { mode: 'no-plan-snapshots', parts: nullParts, unattributed: totalMinutes, beforeRevision: 0 };
  }

  const grouped = estimate.parts.filter((part) => part.group !== undefined);
  const split = splitManual({ input, records, lost, total, grouped, boundary });
  const groups = new Set(grouped.map((part) => part.group as string));
  const walk = new CheckboxWalk(split.pooled, groups, exclusions, boundary, input.startedAt.toMillis());
  for (const step of timeline(points, completionPoints(input, boundary, exclusions))) {
    walk.step(step);
  }
  const walked = walk.finish(input.closedAt.toMillis());
  const pool = walked.pool + untimed(records, (item) => !split.direct(item)).millis;
  const exact = partMillis(estimate, grouped, walked.byGroup, split.directMillis);
  const before = walked.before + (split.directMillis.get(BEFORE) ?? 0);
  if (afterBoundary.length === 0) {
    // No plan after the revision: the time before it is known, the rest belongs to no part.
    const beforeMinutes = Math.min(totalMinutes, Math.round(before / 60_000));
    return { mode: 'no-plan-snapshots', parts: nullParts, unattributed: totalMinutes - beforeMinutes, beforeRevision: beforeMinutes };
  }
  const minutes = largestRemainder([...exact, pool, before].map((ms) => ms / 60_000), totalMinutes);
  return {
    mode: 'by-checkboxes',
    parts: estimate.parts.map((part, i): PartFact =>
      part.group === undefined ? { minutes: null, reason: 'no-group' } : { minutes: minutes[i] ?? 0 },
    ),
    unattributed: minutes.at(-2) ?? 0,
    beforeRevision: minutes.at(-1) ?? 0,
  };
}

/** Snapshots of the plan in time order; after the revision without the changes it took out. */
function planPoints(input: PartFactsInput, boundary: number | undefined, exclusions: PlanExclusions): Point[] {
  return basePoints(
    input.points.map((point) => ({ ...point, millis: clamp(point.at, input) })),
    input.revision?.id,
    boundary,
  )
    .map((point) => (boundary === undefined || point.millis < boundary ? point : withoutExcluded(point, exclusions)))
    .sort((a, b) => a.millis - b.millis);
}

/** Completions in time; after the revision none of a directory it took out. */
function completionPoints(input: PartFactsInput, boundary: number | undefined, exclusions: PlanExclusions): (CompletionPoint & { readonly millis: number })[] {
  return input.completions
    .map((c) => ({ ...c, millis: clamp(c.at, input) }))
    .filter((c) => boundary === undefined || c.millis < boundary || c.directory === undefined || !isExcludedDirectory(exclusions, c.project, c.change, c.directory));
}

/**
 * Manual time that goes straight to a part (recorded for a grouped part) or
 * to the previous plan (recorded before the revision for a part or without a
 * moment), and the measured time left to slice by the plan.
 */
function splitManual(c: {
  readonly input: PartFactsInput;
  readonly records: readonly ManualItem[];
  readonly lost: IntervalSet;
  readonly total: Duration;
  readonly grouped: readonly EstimatePart[];
  readonly boundary: number | undefined;
}): { readonly pooled: { agent: IntervalSet; user: IntervalSet }; readonly directMillis: Map<string, number>; readonly direct: (item: ManualItem) => boolean } {
  const { boundary, grouped, records } = c;
  // Manual time recorded before the revision for a part, or without a moment, was about the previous plan.
  const early = (item: ManualItem): boolean =>
    boundary !== undefined &&
    (item.record.part !== undefined || item.record.at === undefined) &&
    (item.recordedAt === undefined || item.recordedAt.toMillis() < boundary);
  // Manual time recorded for a grouped part goes to it; the rest of the fact is sliced by time.
  const ownManual = (item: ManualItem): boolean =>
    !early(item) && item.record.part !== undefined && grouped.some((part) => part.id === item.record.part);
  const direct = (item: ManualItem) => ownManual(item) || early(item);
  const pooled = timedSets(c.input.measured, records, c.lost, (item) => !direct(item));
  const directMillis = new Map<string, number>();
  const ownMillis = c.total.millis - pooled.agent.total.millis - pooled.user.total.millis - untimed(records, (item) => !direct(item)).millis;
  distributeOwnManual(
    records.filter(direct).map((item) => ({ key: early(item) ? BEFORE : (item.record.part as string), duration: item.record.duration })),
    ownMillis,
    directMillis,
  );
  return { pooled, directMillis, direct };
}

/** A group's time is shared by its parts in proportion to their most likely hours; manual time for a part comes on top. */
function partMillis(estimate: Estimate, grouped: readonly EstimatePart[], byGroup: ReadonlyMap<string, number>, directMillis: ReadonlyMap<string, number>): number[] {
  return estimate.parts.map((part) => {
    if (part.group === undefined) {
      return 0;
    }
    const siblings = grouped.filter((other) => other.group === part.group);
    const weight = siblings.reduce((sum, other) => sum + other.hours.likely, 0);
    const share = weight === 0 ? 1 / siblings.length : part.hours.likely / weight;
    return (byGroup.get(part.group) ?? 0) * share + (directMillis.get(part.id) ?? 0);
  });
}

/** Key of manual time recorded for a part before the revision. */
const BEFORE = '\u0000before';

interface ManualItem {
  readonly record: ManualTime;
  readonly recordedAt: Timestamp | undefined;
}

type Point = PlanPoint & { readonly millis: number };

/**
 * After a revision the base of the new plan is the earliest snapshot of each
 * project not before it. A `plan.revised` written later than another snapshot
 * of its project (by `--repair`) adds nothing and is dropped, so a repair does
 * not change the split; `plan.revised` of earlier revisions after the boundary are dropped too.
 */
function basePoints(points: readonly Point[], revision: string | undefined, boundary: number | undefined): Point[] {
  if (boundary === undefined) {
    return points.filter((point) => point.revision === undefined);
  }
  return points.filter((point) => {
    if (point.revision === undefined || point.millis < boundary) {
      return true;
    }
    if (point.revision !== revision) {
      return false;
    }
    return !points.some((other) => other !== point && other.project === point.project && other.revision === undefined && other.millis >= boundary && other.millis < point.millis);
  });
}

/** Archives a revision took out of the plan are no work of the task. */
function withoutExcluded(point: Point, exclusions: PlanExclusions): Point {
  return {
    ...point,
    changes: point.changes.filter(
      (change) => !(change.archived && change.archivedOn !== undefined && isExcluded(exclusions, point.project, change.change, change.archivedOn, change.changedAt)),
    ),
  };
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
  manual: readonly ManualItem[],
  lost: IntervalSet,
  include: (item: ManualItem) => boolean,
): { agent: IntervalSet; user: IntervalSet } {
  const timed = (kind: 'agent' | 'user') =>
    IntervalSet.of(
      manual
        .filter((item) => item.record.kind === kind && include(item))
        .flatMap(({ record }) => record.interval() ?? []),
    );
  return { agent: measured.agent.union(timed('agent')).minus(lost), user: measured.user.union(timed('user')).minus(lost) };
}

function untimed(manual: readonly ManualItem[], include: (item: ManualItem) => boolean): Duration {
  return Duration.sum(manual.filter((item) => item.record.at === undefined && include(item)).map((item) => item.record.duration));
}

/** What manual time of the parts adds to the fact goes to the parts, in proportion to their records. */
function distributeOwnManual(records: readonly { readonly key: string; readonly duration: Duration }[], millis: number, direct: Map<string, number>): void {
  const sum = records.reduce((total, record) => total + record.duration.millis, 0);
  if (sum === 0 || millis <= 0) {
    return;
  }
  for (const record of records) {
    direct.set(record.key, (direct.get(record.key) ?? 0) + (millis * record.duration.millis) / sum);
  }
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
