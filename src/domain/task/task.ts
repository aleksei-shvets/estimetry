import { Estimate, type EstimateData } from '../estimate/estimate.js';
import { Extra, type ExtraData } from '../measurement/extra.js';
import { ManualTime, type ManualTimeData } from '../measurement/manual-time.js';
import type { ParallelModeChange, ParallelPeriod } from '../measurement/parallel-mode.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { EventMeta } from '../shared/event-envelope.js';
import { Timestamp } from '../shared/timestamp.js';
import { ProjectId } from '../project/project-id.js';
import {
  EstimateLocked,
  InvalidTransition,
  ParallelModeConflict,
  TaskNotStarted,
  UnknownEstimatePart,
} from './task-errors.js';
import {
  taskEvent,
  type TaskAttached,
  type TaskCreated,
  type TaskEstimated,
  type TaskEvent,
  type TaskExtraRecorded,
  type TaskManualTimeRecorded,
  type TaskParallelModeDisabled,
  type TaskParallelModeEnabled,
  type TaskStarted,
} from './task-events.js';
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
  readonly estimate?: EstimateData;
  readonly manualTime: readonly ManualTimeData[];
  readonly extras: readonly ExtraData[];
  readonly parallelMode: readonly ParallelPeriod[];
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
  estimate: EstimateData | undefined;
  manualTime: ManualTimeData[];
  extras: ExtraData[];
  parallelMode: ParallelPeriod[];
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
        estimate: snapshot.estimate,
        manualTime: [...snapshot.manualTime],
        extras: [...snapshot.extras],
        parallelMode: [...snapshot.parallelMode],
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

  get title(): string {
    return this.state.title;
  }

  /** When work started; absent before `start`. */
  get startedAt(): Timestamp | undefined {
    return this.state.startedAt === undefined ? undefined : Timestamp.parse(this.state.startedAt);
  }

  get estimate(): Estimate | undefined {
    return this.state.estimate === undefined ? undefined : Estimate.fromData(this.state.estimate);
  }

  get manualTime(): ManualTime[] {
    return this.state.manualTime.map((data) => ManualTime.fromData(data));
  }

  get extras(): Extra[] {
    return this.state.extras.map((data) => Extra.fromData(data));
  }

  get parallelMode(): readonly ParallelPeriod[] {
    return this.state.parallelMode;
  }

  get isParallel(): boolean {
    return this.state.parallelMode.at(-1)?.disabledAt === undefined && this.state.parallelMode.length > 0;
  }

  isStartable(): boolean {
    return STARTABLE_STATUSES.includes(this.state.status);
  }

  belongsTo(project: ProjectId): boolean {
    return this.state.projects.includes(project.value);
  }

  /** `at` backdates the start for work begun before the task was recorded; it may precede creation. */
  start(project: ProjectId, meta: EventMeta, at?: Timestamp): void {
    if (!this.isStartable()) {
      throw new InvalidTransition(this.state.id.toString(), this.state.status, 'start');
    }
    if (at !== undefined && at.toMillis() > meta.at.toMillis()) {
      throw new InvalidValue(`start time must not be in the future (${at.toISOString()})`);
    }
    this.record(
      taskEvent<TaskStarted>(
        'task.started',
        this.state.id,
        project.value,
        { estimated: this.state.estimated, ...(at === undefined ? {} : { at: at.toISOString() }) },
        meta,
      ),
    );
  }

  /**
   * Makes `estimate` the plan of the task. Re-estimating is allowed until work
   * starts; after that the estimate is what the fact is compared with.
   * `type` is the estimate's task type, already checked against the catalog.
   */
  saveEstimate(estimate: Estimate, type: TaskType | undefined, meta: EventMeta): void {
    if (!this.isStartable()) {
      throw new EstimateLocked(this.state.id.toString(), this.state.status);
    }
    this.record(
      taskEvent<TaskEstimated>(
        'task.estimated',
        this.state.id,
        this.homeProject.value,
        { estimate: estimate.toData(), ...(type === undefined ? {} : { taskType: type.value }) },
        meta,
      ),
    );
  }

  recordManualTime(manual: ManualTime, meta: EventMeta): void {
    const startedAt = this.requireInProgress();
    if (manual.at !== undefined) {
      if (manual.at.toMillis() > meta.at.toMillis()) {
        throw new InvalidValue(`manual time cannot end in the future (${manual.at.toISOString()})`);
      }
      // Time before the start is not the task's, so a record must fit after it.
      const begins = Timestamp.fromMillis(manual.at.toMillis() - manual.duration.millis);
      if (begins.toMillis() < startedAt.toMillis()) {
        throw new InvalidValue(
          `manual time must lie after the task started (${startedAt.toISOString()}), but ${manual.duration.minutes}m ending ${manual.at.toISOString()} starts at ${begins.toISOString()}`,
        );
      }
    }
    this.record(
      taskEvent<TaskManualTimeRecorded>(
        'task.manual-time-recorded',
        this.state.id,
        this.homeProject.value,
        manual.toData(),
        meta,
      ),
    );
  }

  recordExtra(extra: Extra, meta: EventMeta): void {
    this.requireInProgress();
    this.record(
      taskEvent<TaskExtraRecorded>('task.extra-recorded', this.state.id, this.homeProject.value, extra.toData(), meta),
    );
  }

  enableParallelMode(change: ParallelModeChange, meta: EventMeta): void {
    this.requireInProgress();
    if (this.isParallel) {
      throw new ParallelModeConflict(this.state.id.toString(), true);
    }
    const known = this.state.estimate?.parts.map((part) => part.id) ?? [];
    const unknown = change.parts.filter((part) => !known.includes(part));
    if (unknown.length > 0) {
      throw new UnknownEstimatePart(unknown, known);
    }
    this.record(
      taskEvent<TaskParallelModeEnabled>(
        'task.parallel-mode-enabled',
        this.state.id,
        this.homeProject.value,
        change.toData(),
        meta,
      ),
    );
  }

  disableParallelMode(meta: EventMeta): void {
    this.requireInProgress();
    if (!this.isParallel) {
      throw new ParallelModeConflict(this.state.id.toString(), false);
    }
    this.record(
      taskEvent<TaskParallelModeDisabled>('task.parallel-mode-disabled', this.state.id, this.homeProject.value, {}, meta),
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
      ...(s.estimate === undefined ? {} : { estimate: s.estimate }),
      manualTime: [...s.manualTime],
      extras: [...s.extras],
      parallelMode: [...s.parallelMode],
      version: this.appliedCount,
      lastEventId: this.lastId,
    };
  }

  private requireInProgress(): Timestamp {
    const startedAt = this.startedAt;
    if (this.state.status !== 'in-progress' || startedAt === undefined) {
      throw new TaskNotStarted(this.state.id.toString(), this.state.status);
    }
    return startedAt;
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
        this.state.startedAt = event.data.at ?? event.ts;
        break;
      case 'task.estimated':
        this.state.status = 'estimated';
        this.state.estimated = true;
        this.state.estimate = event.data.estimate;
        if (event.data.taskType !== undefined) {
          this.state.type = TaskType.restore(event.data.taskType);
        }
        break;
      case 'task.manual-time-recorded':
        this.state.manualTime.push(event.data);
        break;
      case 'task.extra-recorded':
        this.state.extras.push(event.data);
        break;
      case 'task.parallel-mode-enabled':
        this.state.parallelMode.push({ enabledAt: event.ts, change: event.data });
        break;
      case 'task.parallel-mode-disabled': {
        const last = this.state.parallelMode.at(-1);
        if (last) {
          this.state.parallelMode[this.state.parallelMode.length - 1] = { ...last, disabledAt: event.ts };
        }
        break;
      }
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
      estimate: undefined,
      manualTime: [],
      extras: [],
      parallelMode: [],
    };
  }
}
