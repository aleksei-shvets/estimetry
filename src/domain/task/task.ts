import { InvalidValue } from '../shared/domain-error.js';
import type { EventMeta } from '../shared/event-envelope.js';
import { ProjectId } from '../project/project-id.js';
import { InvalidTransition } from './task-errors.js';
import { taskEvent, type TaskAttached, type TaskCreated, type TaskEvent, type TaskStarted } from './task-events.js';
import { TaskId } from './task-id.js';
import { STARTABLE_STATUSES, type TaskStatus } from './task-status.js';
import { TaskType } from './task-type.js';

export const TASK_SNAPSHOT_SCHEMA_VERSION = 1;

const MAX_TITLE_LENGTH = 200;

/** Persisted state of the aggregate; `version` counts applied events. */
export interface TaskSnapshot {
  readonly schemaVersion: number;
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly ticket?: string;
  readonly status: TaskStatus;
  readonly estimated: boolean;
  readonly projects: readonly string[];
  readonly author: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly version: number;
  readonly lastEventId: string;
}

interface TaskState {
  id: TaskId;
  title: string;
  type: TaskType;
  ticket: string | undefined;
  status: TaskStatus;
  estimated: boolean;
  projects: string[];
  author: string;
  createdAt: string;
  startedAt: string | undefined;
}

/**
 * Aggregate root of the task lifecycle. Every state change goes through
 * `apply`, so a task rebuilt from its journal equals the one restored from a
 * snapshot. New events wait in `pending` until the repository pulls them.
 */
export class Task {
  private pending: TaskEvent[] = [];

  private constructor(
    private state: TaskState,
    private appliedCount: number,
    private lastId: string,
    /** Version the task had when it was loaded; the repository checks it on save. */
    readonly loadedVersion: number,
  ) {}

  static create(
    input: { id: TaskId; title: string; type: TaskType; ticket?: string; project: ProjectId },
    meta: EventMeta,
  ): Task {
    const title = input.title.trim();
    if (title === '') {
      throw new InvalidValue('task title must not be empty');
    }
    if (title.length > MAX_TITLE_LENGTH) {
      throw new InvalidValue(`task title must be at most ${MAX_TITLE_LENGTH} characters`);
    }
    const ticket = input.ticket?.trim();
    if (ticket === '') {
      throw new InvalidValue('ticket key must not be empty');
    }
    const event = taskEvent<TaskCreated>(
      'task.created',
      input.id,
      input.project.value,
      { title, taskType: input.type.value, ...(ticket === undefined ? {} : { ticket }) },
      meta,
    );
    const task = new Task(Task.initialState(event), 0, '', 0);
    task.appliedCount = 1;
    task.lastId = event.id;
    task.pending.push(event);
    return task;
  }

  static fromEvents(events: readonly TaskEvent[]): Task {
    const [first, ...rest] = events;
    if (first?.type !== 'task.created') {
      throw new InvalidValue('task journal must start with task.created');
    }
    const task = new Task(Task.initialState(first), 1, first.id, events.length);
    for (const event of rest) {
      task.apply(event);
    }
    return task;
  }

  static rehydrate(snapshot: TaskSnapshot): Task {
    return new Task(
      {
        id: TaskId.parse(snapshot.id),
        title: snapshot.title,
        type: TaskType.restore(snapshot.type),
        ticket: snapshot.ticket,
        status: snapshot.status,
        estimated: snapshot.estimated,
        projects: [...snapshot.projects],
        author: snapshot.author,
        createdAt: snapshot.createdAt,
        startedAt: snapshot.startedAt,
      },
      snapshot.version,
      snapshot.lastEventId,
      snapshot.version,
    );
  }

  get id(): TaskId {
    return this.state.id;
  }

  get status(): TaskStatus {
    return this.state.status;
  }

  get estimated(): boolean {
    return this.state.estimated;
  }

  get projects(): readonly string[] {
    return this.state.projects;
  }

  /** The project the task was created in. */
  get homeProject(): ProjectId {
    return ProjectId.parse(this.state.projects[0] ?? '');
  }

  get version(): number {
    return this.appliedCount;
  }

  isStartable(): boolean {
    return STARTABLE_STATUSES.includes(this.state.status);
  }

  belongsTo(project: ProjectId): boolean {
    return this.state.projects.includes(project.value);
  }

  start(project: ProjectId, meta: EventMeta): void {
    if (!this.isStartable()) {
      throw new InvalidTransition(this.state.id.toString(), this.state.status, 'start');
    }
    this.record(
      taskEvent<TaskStarted>('task.started', this.state.id, project.value, { estimated: this.state.estimated }, meta),
    );
  }

  /** Connects the task to another project. Returns false if it was already connected. */
  attach(project: ProjectId, meta: EventMeta): boolean {
    if (this.state.status === 'closed') {
      throw new InvalidTransition(this.state.id.toString(), this.state.status, 'attach');
    }
    if (this.belongsTo(project)) {
      return false;
    }
    this.record(taskEvent<TaskAttached>('task.attached', this.state.id, project.value, {}, meta));
    return true;
  }

  pullEvents(): TaskEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  toSnapshot(): TaskSnapshot {
    const s = this.state;
    return {
      schemaVersion: TASK_SNAPSHOT_SCHEMA_VERSION,
      id: s.id.toString(),
      title: s.title,
      type: s.type.value,
      ...(s.ticket === undefined ? {} : { ticket: s.ticket }),
      status: s.status,
      estimated: s.estimated,
      projects: [...s.projects],
      author: s.author,
      createdAt: s.createdAt,
      ...(s.startedAt === undefined ? {} : { startedAt: s.startedAt }),
      version: this.appliedCount,
      lastEventId: this.lastId,
    };
  }

  private record(event: TaskEvent): void {
    this.apply(event);
    this.pending.push(event);
  }

  private apply(event: TaskEvent): void {
    switch (event.type) {
      case 'task.created':
        throw new InvalidValue(`task ${this.state.id.toString()} is created twice`);
      case 'task.started':
        this.state.status = 'in-progress';
        this.state.startedAt = event.ts;
        break;
      case 'task.attached':
        if (event.project !== undefined && !this.state.projects.includes(event.project)) {
          this.state.projects.push(event.project);
        }
        break;
    }
    this.appliedCount += 1;
    this.lastId = event.id;
  }

  private static initialState(event: TaskCreated): TaskState {
    return {
      id: TaskId.parse(event.task),
      title: event.data.title,
      type: TaskType.restore(event.data.taskType),
      ticket: event.data.ticket,
      status: 'new',
      estimated: false,
      projects: event.project === undefined ? [] : [event.project],
      author: event.author,
      createdAt: event.ts,
      startedAt: undefined,
    };
  }
}
