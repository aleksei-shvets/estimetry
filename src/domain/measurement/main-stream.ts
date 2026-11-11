import type { ActivityEvent, TurnOrigin, TurnStarted } from './activity-events.js';
import type { Collector } from './collector.js';
import { logTurnAt } from './log-matching.js';
import type { Prepared } from './prepared-events.js';
import { Run, type StreamContext } from './run.js';
import { key, MAIN } from './timeline.js';

/** Parallel hook processes can swap the times of neighbouring events by up to this much. */
const ORDER_JITTER_MS = 1_000;

interface Turn {
  readonly run: Run;
  readonly origin: TurnOrigin;
  readonly id: string | undefined;
}

/**
 * The main agent of a session alternates with the user: while a turn runs the
 * time is the agent's, between turns it is the user's. Automated turns are
 * agent time and leave the user's span open.
 */
export function mainStream(session: string, items: readonly Prepared[], c: Collector, ctx: StreamContext): void {
  new MainStream(session, items, c, ctx).pass(items);
}

/** The state of one pass over the main agent's events of a session. */
class MainStream {
  private readonly agentKey: string;
  private turn: Turn | undefined;
  /** The user has control: the span opened by `session.started` or by the end of a user turn. */
  private span = false;
  private cursor = 0;
  /** The next user gap follows a turn closed by a heuristic, which already counted its doubt. */
  private quiet = false;
  private seen = false;
  /** When each turn reported its end, to tell a late end from a turn that never ended. */
  private readonly endsAt = new Map<string, number>();

  constructor(
    private readonly session: string,
    items: readonly Prepared[],
    private readonly c: Collector,
    private readonly ctx: StreamContext,
  ) {
    this.agentKey = key(session, MAIN);
    for (const { event, at } of items) {
      if (event.type === 'turn.ended' && event.data.turn !== undefined && !this.endsAt.has(event.data.turn)) {
        this.endsAt.set(event.data.turn, at);
      }
    }
  }

  pass(items: readonly Prepared[]): void {
    for (const { event, at } of items) {
      if (this.step(event, at)) {
        this.seen = true;
      }
    }
    this.finish();
  }

  /** Applies one event; false when the event leaves `seen` as it was. */
  private step(event: ActivityEvent, at: number): boolean {
    switch (event.type) {
      case 'session.started':
        return this.sessionStarted(at);
      case 'session.ended':
      case 'session.unbound':
        this.sessionEnded(at);
        return true;
      case 'session.bound':
        return this.sessionBound(at);
      case 'turn.started':
        this.turnStarted(event, at);
        return true;
      default:
        return this.inTurn(event, at);
    }
  }

  private sessionStarted(at: number): boolean {
    if (this.turn) {
      return false; // context compaction inside a turn, not a new start
    }
    this.userHasControl(at);
    return true;
  }

  /** Leaving the task ends an open turn there and then, like the end of the session. */
  private sessionEnded(at: number): void {
    if (this.turn) {
      this.turn.run.end(at);
      this.turn = undefined;
    } else {
      this.userUntil(at);
    }
    this.span = false;
  }

  /** The session joins the task: the user has it from now, and a turn found mid-way starts here. */
  private sessionBound(at: number): boolean {
    if (this.turn) {
      return true;
    }
    this.userHasControl(at);
    this.seen = false;
    return false;
  }

  private turnStarted(event: TurnStarted, at: number): void {
    const turn = this.turn;
    if (turn && turn.id !== undefined && turn.id === event.data.turn) {
      // A message delivered mid-turn (a subagent report, a queued prompt): the same turn goes on.
      turn.run.step(event, at);
      return;
    }
    if (turn) {
      const lateEnd = turn.id === undefined ? undefined : this.endsAt.get(turn.id);
      if (lateEnd !== undefined && lateEnd >= at && lateEnd - at <= ORDER_JITTER_MS) {
        // The previous turn did end; its end only arrived a moment after this start.
        turn.run.end(at);
        this.closeTurn(at);
      } else {
        this.abandonTurn(at); // interrupted: the tool never reported the end of the previous turn
      }
    }
    this.userUntil(at);
    if (event.data.origin === 'user') {
      this.span = false;
    }
    this.turn = { run: new Run(this.session, this.agentKey, at, this.c), origin: event.data.origin, id: event.data.turn };
  }

  /** Any other event: a step of the running turn. */
  private inTurn(event: ActivityEvent, at: number): boolean {
    if (event.type === 'turn.ended' && this.turn?.id !== undefined && event.data.turn !== undefined && event.data.turn !== this.turn.id) {
      return false; // the late end of an earlier turn: parallel hooks swapped places with the next turn's start
    }
    let turn = this.turn;
    if (!turn) {
      if (this.seen) {
        return false; // e.g. a notification after the turn ended
      }
      turn = this.joinMidTurn(at);
    }
    turn.run.step(event, at);
    if (event.type === 'turn.ended') {
      this.closeTurn(at);
    }
    return true;
  }

  /**
   * The session joined the task mid-turn (`emt start` or a binding ran inside
   * it): the turn began then. The log tells when, unless that is longer ago
   * than the threshold: a wait of any length would come in.
   */
  private joinMidTurn(at: number): Turn {
    const floor = Math.max(this.ctx.startedAt, this.ctx.windowStart(at));
    const logged = logTurnAt(this.ctx.log, at);
    const known = logged !== undefined && logged.start >= at - this.c.idle;
    const start = Math.min(at, Math.max(floor, known ? logged.start : at - this.c.idle));
    this.userUntil(start);
    this.span = false;
    this.c.addAgent(this.agentKey, start, at);
    if (!known) {
      this.c.doubt(this.session, this.agentKey, true, start, at);
    }
    this.turn = { run: new Run(this.session, this.agentKey, at, this.c), origin: 'user', id: undefined };
    return this.turn;
  }

  /** A turn still open at the end runs until now if it is recent, else it is abandoned; then the user has the rest. */
  private finish(): void {
    if (this.turn) {
      if (this.ctx.now - this.turn.run.last <= this.c.idle) {
        this.turn.run.end(this.ctx.now); // still running
      } else {
        this.abandonTurn(this.ctx.now);
      }
    }
    if (!this.turn) {
      this.userUntil(this.ctx.now);
    }
  }

  /** The user has the session from `at`, after the span already open if there is one. */
  private userHasControl(at: number): void {
    if (this.span) {
      this.userUntil(at);
    } else {
      this.span = true;
      this.cursor = at;
      this.quiet = false;
    }
  }

  private userUntil(at: number): void {
    if (this.span) {
      this.c.userGap(this.session, this.cursor, at, this.quiet);
      this.cursor = at;
    }
    this.quiet = false;
  }

  private closeTurn(at: number): void {
    if (this.turn?.origin === 'user') {
      this.span = true;
    }
    if (this.span) {
      this.cursor = at;
    }
    this.turn = undefined;
  }

  /**
   * A turn that never got its closing event. The log's turn holding its last
   * event closes it, as a `turn.ended` would, and the usual rules go on; without
   * one it ends at its last event, and the rest is doubtful.
   */
  private abandonTurn(next: number): void {
    if (!this.turn) {
      return;
    }
    const last = this.turn.run.last;
    const logged = logTurnAt(this.ctx.log, last);
    if (logged !== undefined) {
      const end = Math.max(last, Math.min(logged.end, next));
      this.turn.run.end(end);
      this.closeTurn(end);
      this.quiet = false;
      return;
    }
    this.c.doubt(this.session, this.agentKey, false, last, Math.min(last + this.c.idle, next));
    this.closeTurn(last);
    this.quiet = true;
  }
}
