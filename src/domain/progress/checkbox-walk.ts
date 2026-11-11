import type { IntervalSet } from '../measurement/interval-set.js';
import { Timestamp } from '../shared/timestamp.js';
import type { PlanExclusions } from './plan-exclusions.js';

/** The progress of one change of one project at a step. */
export interface Update {
  readonly project: string;
  readonly change: string;
  readonly done: number;
}

/** A moment of the plan: snapshots and completions at one time. */
export interface Step {
  readonly millis: number;
  readonly updates: readonly Update[];
}

/**
 * One pass over the steps of the plan: time since the previous step waits in
 * a pool and goes to the groups whose checkboxes closed, in proportion to how
 * many closed. Time before the revision belongs to the previous plan.
 */
export class CheckboxWalk {
  private readonly byGroup = new Map<string, number>();
  private readonly last = new Map<string, number>();
  private readonly seenProject = new Set<string>();
  private pool = 0;
  private before = 0;
  private crossed: boolean;

  constructor(
    private readonly pooled: { agent: IntervalSet; user: IntervalSet },
    private readonly groups: ReadonlySet<string>,
    private readonly exclusions: PlanExclusions,
    private readonly boundary: number | undefined,
    private cursor: number,
  ) {
    this.crossed = boundary === undefined;
  }

  step(step: Step): void {
    if (!this.crossed && step.millis >= (this.boundary as number)) {
      this.cross();
    }
    if (this.crossed) {
      this.pool += sliceMillis(this.pooled, this.cursor, step.millis);
      this.cursor = Math.max(this.cursor, step.millis);
    }
    const closed = this.closedBoxes(step);
    const count = [...closed.values()].reduce((a, b) => a + b, 0);
    if (count > 0 && this.pool > 0) {
      for (const [group, n] of closed) {
        this.byGroup.set(group, (this.byGroup.get(group) ?? 0) + (this.pool * n) / count);
      }
      this.pool = 0;
    }
  }

  /** Time after the last step up to the closing stays in the pool. */
  finish(closedAt: number): { readonly byGroup: ReadonlyMap<string, number>; readonly pool: number; readonly before: number } {
    if (!this.crossed) {
      this.cross();
    }
    this.pool += sliceMillis(this.pooled, this.cursor, closedAt);
    return { byGroup: this.byGroup, pool: this.pool, before: this.before };
  }

  /** Checkboxes closed in this step, by group. */
  private closedBoxes(step: Step): Map<string, number> {
    const closed = new Map<string, number>();
    for (const update of step.updates) {
      const key = `${update.project}\u0000${update.change}`;
      // The first snapshot of a project is the base: boxes closed before it are not the task's.
      // A change that appears later in a project already seen starts from zero.
      const previous = this.last.get(key) ?? (this.seenProject.has(update.project) ? 0 : undefined);
      const done = update.done;
      if (this.crossed && previous !== undefined && done > previous && this.groups.has(update.change)) {
        closed.set(update.change, (closed.get(update.change) ?? 0) + done - previous);
      }
      this.last.set(key, Math.max(previous ?? 0, done));
    }
    for (const update of step.updates) {
      this.seenProject.add(update.project);
    }
    return closed;
  }

  /** Everything counted before the revision is the previous plan's; a change taken out starts anew. */
  private cross(): void {
    this.before += sliceMillis(this.pooled, this.cursor, this.boundary as number);
    this.cursor = Math.max(this.cursor, this.boundary as number);
    for (const key of [...this.last.keys()]) {
      const [project, change] = key.split('\u0000') as [string, string];
      if (this.exclusions.archives.some((a) => a.project === project && a.change === change)) {
        this.last.delete(key);
      }
    }
    this.crossed = true;
  }
}

/** Measured time of agents and the user between two moments. */
function sliceMillis(sets: { agent: IntervalSet; user: IntervalSet }, from: number, to: number): number {
  if (to <= from) {
    return 0;
  }
  const start = Timestamp.fromMillis(from);
  const end = Timestamp.fromMillis(to);
  return sets.agent.within(start, end).total.millis + sets.user.within(start, end).total.millis;
}
