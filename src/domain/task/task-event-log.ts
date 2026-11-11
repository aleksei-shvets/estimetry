import type { TaskEvent } from './task-events.js';

/**
 * The events of one aggregate: how many are applied, the id of the last one,
 * and the new ones the repository has not pulled yet.
 */
export class TaskEventLog {
  private pending: TaskEvent[] = [];

  constructor(
    private applied: number,
    private lastId: string,
  ) {}

  /** Number of applied events: the version of the aggregate. */
  get count(): number {
    return this.applied;
  }

  get lastEventId(): string {
    return this.lastId;
  }

  noteApplied(event: TaskEvent): void {
    this.applied += 1;
    this.lastId = event.id;
  }

  /** A new event, applied already, waits for the repository. */
  hold(event: TaskEvent): void {
    this.pending.push(event);
  }

  pull(): TaskEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }
}
