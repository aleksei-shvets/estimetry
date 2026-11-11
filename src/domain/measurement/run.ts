import type { ActivityEvent } from './activity-events.js';
import type { Collector } from './collector.js';
import type { LogBoundaries } from './log-boundaries.js';

/** What the streams of one session know besides their own events. */
export interface StreamContext {
  readonly startedAt: number;
  readonly now: number;
  /** Start of the window of the session that holds `at`; the earliest time when the session has no windows. */
  readonly windowStart: (at: number) => number;
  readonly log?: LogBoundaries;
}

/** One stretch of work of one agent: a turn of the main agent or the life of a subagent. */
export class Run {
  last: number;
  private waiting = false;
  private readonly tools = new Set<string>();
  /** Calls already reported as finished: parallel hooks may deliver the end before the start. */
  private readonly finished = new Set<string>();
  /** Tools started without an id; matched with completions by order. */
  private anonymousTools = 0;

  constructor(
    private readonly session: string,
    private readonly agentKey: string,
    start: number,
    private readonly c: Collector,
  ) {
    this.last = start;
  }

  /** Accounts for the time since the previous event, then applies `event`. */
  step(event: ActivityEvent, at: number): void {
    if (this.waiting && event.type === 'tool.started') {
      // The permission prompt can arrive before the start of its own call; the wait goes on.
      this.startTool(event.data.toolUseId);
      return;
    }
    if (this.waiting) {
      // Waiting for the user outweighs a running tool: a permission prompt keeps the tool "running".
      let waitEnd = at;
      let untimed = false;
      if (event.type === 'tool.used') {
        const paired = this.finishTool(event.data.toolUseId);
        if (paired && event.data.durationMs !== undefined) {
          waitEnd = Math.max(this.last, at - event.data.durationMs);
        } else if (paired) {
          untimed = true;
        }
      }
      this.c.waiting(this.agentKey, this.session, this.last, waitEnd, untimed);
      this.c.agentGap(this.agentKey, waitEnd, at, true);
      this.waiting = false;
    } else {
      this.c.agentGap(this.agentKey, this.last, at, this.toolRunning);
      if (event.type === 'tool.used') {
        this.finishTool(event.data.toolUseId);
      }
    }
    if (event.type === 'tool.started') {
      this.startTool(event.data.toolUseId);
    }
    if (event.type === 'turn.awaiting-input') {
      this.waiting = true;
    }
    this.last = at;
  }

  /** Ends the run at `at` without a closing event of its own (session end, or now while it runs). */
  end(at: number): void {
    if (this.waiting) {
      this.c.waiting(this.agentKey, this.session, this.last, at, false);
    } else {
      this.c.agentGap(this.agentKey, this.last, at, this.toolRunning);
    }
    this.last = Math.max(this.last, at);
  }

  private startTool(toolUseId: string | undefined): void {
    if (toolUseId === undefined) {
      this.anonymousTools += 1;
    } else if (!this.finished.has(toolUseId)) {
      this.tools.add(toolUseId);
    }
  }

  private get toolRunning(): boolean {
    return this.tools.size > 0 || this.anonymousTools > 0;
  }

  /** Returns true if the completion matched a started tool. */
  private finishTool(toolUseId: string | undefined): boolean {
    if (toolUseId !== undefined) {
      this.finished.add(toolUseId);
    }
    if (toolUseId !== undefined && this.tools.delete(toolUseId)) {
      return true;
    }
    if (this.anonymousTools > 0) {
      this.anonymousTools -= 1;
      return true;
    }
    return false;
  }
}
