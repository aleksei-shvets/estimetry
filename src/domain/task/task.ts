import { Estimate, type EstimateData } from '../estimate/estimate.js';
import type { EstimateRevision, ExcludedArchives, SpentPolicy } from '../estimate/estimate-revision.js';
import { exclusionsOf, type PlanExclusions } from '../progress/plan-exclusions.js';
import { Extra, type ExtraCategory, type ExtraData } from '../measurement/extra.js';
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
  TaskClosed,
  TaskNotClosed,
  TaskNotStarted,
  UnknownEstimatePart,
} from './task-errors.js';
import {
  taskEvent,
  type RetroReason,
  type TaskAttached,
  type TaskClosed as TaskClosedEvent,
  type TaskCreated,
  type TaskOutcome,
  type TaskEstimateRevised,
  type TaskReopened,
  type TaskRetroRecorded,
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

/** 2: revisions, the first estimate, ids of extra work. Older snapshots are rebuilt from the journal. */
export const TASK_SNAPSHOT_SCHEMA_VERSION = 2;

const MAX_TITLE_LENGTH = 200;

/** One closing of the task; `reopenedAt` is set when it was opened again. */
export interface TaskClosure {
  readonly at: string;
  readonly outcome: TaskOutcome;
  readonly spawned?: string;
  readonly reopenedAt?: string;
}

/** One revision of the estimate, as the task remembers it. */
export interface TaskRevision {
  readonly id: string;
  readonly at: string;
  readonly lostFrom?: string;
  readonly reason: string;
  readonly category?: ExtraCategory;
  readonly spent?: SpentPolicy;
  /** Most likely hours before calibration, of the estimate before and after; absent before for a task estimated after its start. */
  readonly baseLikelyBefore?: number;
  readonly baseLikelyAfter: number;
  readonly covers: readonly string[];
  readonly excluded?: readonly ExcludedArchives[];
}

/** Id and time of the event that recorded an extra work, in the order of `extras`. */
export interface ExtraRecord {
  readonly id: string;
  readonly at: string;
}

/** The retro as the task remembers it; `recordedAt` tells whether it predates a reopening. */
export interface TaskRetro {
  readonly reasons: readonly RetroReason[];
  readonly lesson: string;
  readonly recordedAt: string;
}

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
  readonly spawnedFrom?: string;
  readonly closures?: readonly TaskClosure[];
  readonly retro?: TaskRetro;
  /** Latest moment the aggregate knows of: event times and ends of manual time. */
  readonly lastEventAt?: string;
  readonly firstEstimate?: EstimateData;
  readonly estimatedAfterStart?: boolean;
  readonly revisions?: readonly TaskRevision[];
  readonly extraRecords?: readonly ExtraRecord[];
  /** When each manual record was made, in the order of `manualTime`. */
  readonly manualRecordedAt?: readonly string[];
  /** When manual time of an estimate part was last recorded: a revision cannot start before it. */
  readonly lastPartRecordAt?: string;
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
  spawnedFrom: string | undefined;
  closures: TaskClosure[];
  retro: TaskRetro | undefined;
  lastEventAt: string;
  firstEstimate: EstimateData | undefined;
  estimatedAfterStart: boolean;
  revisions: TaskRevision[];
  extraRecords: ExtraRecord[];
  manualRecordedAt: string[];
  lastPartRecordAt: string | undefined;
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
    input: { id: TaskId; title: string; type: TaskType; ticket?: string; project: ProjectId; spawnedFrom?: TaskId },
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
      {
        title,
        taskType: input.type.value,
        ...(ticket === undefined ? {} : { ticket }),
        ...(input.spawnedFrom === undefined ? {} : { spawnedFrom: input.spawnedFrom.toString() }),
      },
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
        spawnedFrom: snapshot.spawnedFrom,
        closures: [...(snapshot.closures ?? [])],
        retro: snapshot.retro,
        lastEventAt: snapshot.lastEventAt ?? snapshot.startedAt ?? snapshot.createdAt,
        firstEstimate: snapshot.firstEstimate,
        estimatedAfterStart: snapshot.estimatedAfterStart ?? false,
        revisions: [...(snapshot.revisions ?? [])],
        extraRecords: [...(snapshot.extraRecords ?? [])],
        manualRecordedAt: [...(snapshot.manualRecordedAt ?? [])],
        lastPartRecordAt: snapshot.lastPartRecordAt,
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

  get type(): string {
    return this.state.type.value;
  }

  get ticket(): string | undefined {
    return this.state.ticket;
  }

  get author(): string {
    return this.state.author;
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

  /** The estimate when work started, before any revision; undefined for a task estimated only after its start. */
  get firstEstimate(): Estimate | undefined {
    if (this.state.estimatedAfterStart) {
      return undefined;
    }
    const data = this.state.firstEstimate ?? this.state.estimate;
    return data === undefined ? undefined : Estimate.fromData(data);
  }

  get estimatedAfterStart(): boolean {
    return this.state.estimatedAfterStart;
  }

  get revisions(): readonly TaskRevision[] {
    return this.state.revisions;
  }

  /** The earliest a window of lost work may start: the latest of the start, the previous revision and the last reopening. */
  get lostWindowFloor(): Timestamp | undefined {
    const moments = [
      this.state.startedAt,
      this.state.revisions.at(-1)?.at,
      this.state.closures.map((closure) => closure.reopenedAt).filter((v): v is string => v !== undefined).at(-1),
    ].filter((v): v is string => v !== undefined);
    if (moments.length === 0) {
      return undefined;
    }
    return Timestamp.fromMillis(Math.max(...moments.map((moment) => Timestamp.parse(moment).toMillis())));
  }

  /** Windows of work thrown away by revisions with `exclude`, as `[from, to]`. */
  get lostWindows(): readonly { readonly from: Timestamp; readonly to: Timestamp }[] {
    return this.state.revisions
      .filter((revision) => revision.spent === 'exclude' && revision.lostFrom !== undefined)
      .map((revision) => ({ from: Timestamp.parse(revision.lostFrom as string), to: Timestamp.parse(revision.at) }));
  }

  /**
   * What revisions with `exclude` took out of the plan: archived changes by
   * project, and the moment of the last such revision for projects that were
   * not readable then (their archive counts from that day).
   */
  get planExclusions(): PlanExclusions {
    return exclusionsOf(this.state.revisions);
  }

  /** Extra work with the id and time of its event, for `--covers`. */
  get extraRecords(): readonly (ExtraRecord & { readonly extra: Extra })[] {
    return this.state.extras.map((data, i) => ({
      id: this.state.extraRecords[i]?.id ?? '',
      at: this.state.extraRecords[i]?.at ?? '',
      extra: Extra.fromData(data),
    }));
  }

  /** Manual time with the moment each record was made. */
  get manualRecords(): readonly { readonly manual: ManualTime; readonly recordedAt: string }[] {
    return this.state.manualTime.map((data, i) => ({ manual: ManualTime.fromData(data), recordedAt: this.state.manualRecordedAt[i] ?? '' }));
  }

  get extras(): Extra[] {
    return this.state.extras.map((data) => Extra.fromData(data));
  }

  get parallelMode(): readonly ParallelPeriod[] {
    return this.state.parallelMode;
  }

  get spawnedFrom(): string | undefined {
    return this.state.spawnedFrom;
  }

  /** Every closing of the task, the current one last. */
  get closures(): readonly TaskClosure[] {
    return this.state.closures;
  }

  /** The current closing; undefined while the task is not closed. */
  get closure(): TaskClosure | undefined {
    return this.state.status === 'closed' ? this.state.closures.at(-1) : undefined;
  }

  get closedAt(): Timestamp | undefined {
    const closure = this.closure;
    return closure === undefined ? undefined : Timestamp.parse(closure.at);
  }

  get retro(): TaskRetro | undefined {
    return this.state.retro;
  }

  /** The latest moment the task knows of; closing cannot be earlier. */
  get lastEventAt(): Timestamp {
    return Timestamp.parse(this.state.lastEventAt);
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
    this.rejectClosed();
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
    this.rejectClosed();
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
    if (manual.part !== undefined && !(this.estimate?.hasPart(manual.part) ?? false)) {
      throw new UnknownEstimatePart([manual.part], this.estimate?.partIds ?? []);
    }
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
    this.rejectClosed();
    if (this.belongsTo(project)) {
      return false;
    }
    this.record(taskEvent<TaskAttached>('task.attached', this.state.id, project.value, {}, meta));
    return true;
  }

  /** Throws what `close` would throw before the moment is known: a closed or unstarted task. */
  assertCanClose(): void {
    this.requireInProgress();
  }

  /**
   * Ends the work on the task at `at`. It may be backdated, but not before the
   * start nor before anything the task already knows of: a parallel period or a
   * record after the end would contradict it.
   */
  close(input: { readonly at: Timestamp; readonly outcome: TaskOutcome; readonly spawned?: TaskId }, meta: EventMeta): void {
    this.checkClosingMoment(input.at, meta);
    this.recordClosed(input, meta);
  }

  private checkClosingMoment(at: Timestamp, meta: EventMeta): void {
    const startedAt = this.requireInProgress();
    if (at.toMillis() > meta.at.toMillis()) {
      throw new InvalidValue(`closing time must not be in the future (${at.toISOString()})`);
    }
    if (at.toMillis() < startedAt.toMillis()) {
      throw new InvalidValue(`closing time ${at.toISOString()} is before the start (${startedAt.toISOString()})`);
    }
    if (at.toMillis() < this.lastEventAt.toMillis()) {
      throw new InvalidValue(
        `closing time ${at.toISOString()} is before the last record of the task (${this.lastEventAt.toISOString()})`,
      );
    }
  }

  private recordClosed(input: { readonly at: Timestamp; readonly outcome: TaskOutcome; readonly spawned?: TaskId }, meta: EventMeta): void {
    this.record(
      taskEvent<TaskClosedEvent>(
        'task.closed',
        this.state.id,
        this.homeProject.value,
        {
          at: input.at.toISOString(),
          outcome: input.outcome,
          ...(input.spawned === undefined ? {} : { spawned: input.spawned.toString() }),
        },
        meta,
      ),
    );
  }

  /**
   * Renegotiation (design §3): the extra work moves into `spawned` and the
   * task closes as it is, in one save. A retry finds the extra already there.
   */
  renegotiate(
    input: { readonly at: Timestamp; readonly spawned: TaskId; readonly category: string; readonly description: string },
    meta: { next(): EventMeta },
  ): void {
    // The moment is checked before the extra work is recorded: that record is part of this closing, not before it.
    const first = meta.next();
    this.checkClosingMoment(input.at, first);
    const spawned = input.spawned.toString();
    const recorded = this.state.extras.some((extra) => extra.accounting === 'renegotiated' && extra.spawned === spawned);
    if (!recorded) {
      this.recordExtra(Extra.renegotiated({ category: input.category, description: input.description, spawned }), first);
    }
    this.recordClosed({ at: input.at, outcome: 'renegotiated', spawned: input.spawned }, meta.next());
  }

  reopen(meta: EventMeta): void {
    if (this.state.status !== 'closed') {
      throw new InvalidTransition(this.state.id.toString(), this.state.status, 'reopen');
    }
    this.record(taskEvent<TaskReopened>('task.reopened', this.state.id, this.homeProject.value, {}, meta));
  }

  /**
   * The retro of a closed task: at least one reason and one lesson. A reason
   * may start with `<part id>:`; the prefix counts only when it is a part of
   * the estimate, so a colon in plain text stays text.
   */
  recordRetro(reasons: readonly string[], lesson: string, meta: EventMeta): void {
    if (this.state.status !== 'closed') {
      throw new TaskNotClosed(this.state.id.toString(), this.state.status);
    }
    const parsed = reasons.map((reason) => this.retroReason(reason)).filter((reason) => reason.text !== '');
    if (parsed.length === 0) {
      throw new InvalidValue('a retro needs at least one reason');
    }
    const trimmed = lesson.trim();
    if (trimmed === '') {
      throw new InvalidValue('a retro needs one lesson for the future');
    }
    this.record(
      taskEvent<TaskRetroRecorded>(
        'task.retro-recorded',
        this.state.id,
        this.homeProject.value,
        { reasons: parsed, lesson: trimmed },
        meta,
      ),
    );
  }

  /**
   * A new estimate of a task in progress (estimate-revision spec). The moment
   * may be backdated, but not before anything that refers to the old plan.
   */
  reviseEstimate(revision: EstimateRevision, meta: EventMeta): void {
    const startedAt = this.requireInProgress();
    if (this.isParallel) {
      throw new InvalidValue('parallel mode refers to parts of the current estimate; switch it off first with `emt parallel off`');
    }
    const firstOne = this.state.estimate === undefined;
    if (!firstOne && (revision.spent === undefined || revision.category === undefined)) {
      throw new InvalidValue('a revision needs --spent include or --spent exclude, and --category');
    }
    if (firstOne && (revision.spent !== undefined || revision.lostFrom !== undefined || revision.covers.length > 0)) {
      throw new InvalidValue('the task has no estimate yet, so this is its first one: --spent, --lost-from and --covers do not apply');
    }
    const at = revision.at;
    if (at.toMillis() > meta.at.toMillis()) {
      throw new InvalidValue(`the revision moment must not be in the future (${at.toISOString()})`);
    }
    const last = this.state.revisions.at(-1)?.at;
    const reopened = this.state.closures.map((closure) => closure.reopenedAt).filter((v): v is string => v !== undefined).at(-1);
    const parallelEnd = this.state.parallelMode.at(-1)?.disabledAt;
    const floors: [string, string | undefined][] = [
      ['the start', startedAt.toISOString()],
      ['the previous revision', last],
      ['the last reopening', reopened],
      ['the end of parallel mode', parallelEnd],
      ['the last manual time of an estimate part', this.state.lastPartRecordAt],
    ];
    for (const [what, floor] of floors) {
      if (floor !== undefined && at.toMillis() < Timestamp.parse(floor).toMillis()) {
        throw new InvalidValue(`the revision moment ${at.toISOString()} is before ${what} (${floor})`);
      }
    }
    let lostFrom = revision.lostFrom;
    if (revision.spent === 'exclude') {
      lostFrom ??= this.lostWindowFloor ?? startedAt;
      for (const [what, floor] of floors.slice(0, 3)) {
        if (floor !== undefined && lostFrom.toMillis() < Timestamp.parse(floor).toMillis()) {
          throw new InvalidValue(`--lost-from ${lostFrom.toISOString()} is before ${what} (${floor})`);
        }
      }
      if (lostFrom.toMillis() >= at.toMillis()) {
        throw new InvalidValue('the window of lost work is empty: --lost-from must be before the revision moment');
      }
    }
    const known = new Set(this.state.extraRecords.map((record) => record.id));
    const unknown = revision.covers.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new InvalidValue(`--covers names no extra work of this task: ${unknown.join(', ')}`);
    }
    this.record(
      taskEvent<TaskEstimateRevised>(
        'task.estimate-revised',
        this.state.id,
        this.homeProject.value,
        {
          estimate: revision.estimate.toData(),
          ...(revision.type === undefined ? {} : { taskType: revision.type }),
          reason: revision.reason.value,
          ...(revision.category === undefined || firstOne ? {} : { category: revision.category }),
          ...(revision.spent === undefined || firstOne ? {} : { spent: revision.spent }),
          at: at.toISOString(),
          ...(lostFrom === undefined || firstOne ? {} : { lostFrom: lostFrom.toISOString() }),
          covers: [...revision.covers],
          ...(revision.excluded.length === 0 || firstOne ? {} : { excluded: revision.excluded }),
        },
        meta,
      ),
    );
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
      ...(s.spawnedFrom === undefined ? {} : { spawnedFrom: s.spawnedFrom }),
      ...(s.closures.length === 0 ? {} : { closures: [...s.closures] }),
      ...(s.retro === undefined ? {} : { retro: s.retro }),
      lastEventAt: s.lastEventAt,
      ...(s.firstEstimate === undefined ? {} : { firstEstimate: s.firstEstimate }),
      ...(s.estimatedAfterStart ? { estimatedAfterStart: true } : {}),
      ...(s.revisions.length === 0 ? {} : { revisions: [...s.revisions] }),
      ...(s.extraRecords.length === 0 ? {} : { extraRecords: [...s.extraRecords] }),
      ...(s.manualRecordedAt.length === 0 ? {} : { manualRecordedAt: [...s.manualRecordedAt] }),
      ...(s.lastPartRecordAt === undefined ? {} : { lastPartRecordAt: s.lastPartRecordAt }),
      version: this.appliedCount,
      lastEventId: this.lastId,
    };
  }

  private rejectClosed(): void {
    if (this.state.status === 'closed') {
      throw new TaskClosed(this.state.id.toString());
    }
  }

  /**
   * A reason may start with `<part>:` — the id of a part, or the group of a
   * part alone in its group (people name parts by their change). Any other
   * prefix is plain text.
   */
  private retroReason(reason: string): RetroReason {
    const text = reason.trim();
    const colon = text.indexOf(':');
    const prefix = colon < 0 ? '' : text.slice(0, colon).trim();
    const parts = this.estimate?.parts ?? [];
    const byId = parts.find((part) => part.id === prefix);
    const byGroup = parts.filter((part) => part.group === prefix);
    const part = byId ?? (byGroup.length === 1 ? byGroup[0] : undefined);
    return prefix !== '' && part !== undefined ? { text: text.slice(colon + 1).trim(), part: part.id } : { text };
  }

  private requireInProgress(): Timestamp {
    this.rejectClosed();
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
    this.state.lastEventAt = later(this.state.lastEventAt, event.ts);
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
        this.state.manualRecordedAt.push(event.ts);
        if (event.data.part !== undefined) {
          this.state.lastPartRecordAt = event.ts;
        }
        if (event.data.at !== undefined) {
          this.state.lastEventAt = later(this.state.lastEventAt, event.data.at);
        }
        break;
      case 'task.extra-recorded':
        this.state.extras.push(event.data);
        this.state.extraRecords.push({ id: event.id, at: event.ts });
        break;
      case 'task.estimate-revised': {
        const before = this.state.estimate;
        if (before === undefined) {
          this.state.estimatedAfterStart = true;
        } else {
          this.state.firstEstimate ??= before;
          this.state.revisions.push({
            id: event.id,
            at: event.data.at,
            ...(event.data.lostFrom === undefined ? {} : { lostFrom: event.data.lostFrom }),
            reason: event.data.reason,
            ...(event.data.category === undefined ? {} : { category: event.data.category }),
            ...(event.data.spent === undefined ? {} : { spent: event.data.spent }),
            baseLikelyBefore: Estimate.fromData(before).baseLikely,
            baseLikelyAfter: Estimate.fromData(event.data.estimate).baseLikely,
            covers: [...event.data.covers],
            ...(event.data.excluded === undefined ? {} : { excluded: event.data.excluded }),
          });
        }
        this.state.estimate = event.data.estimate;
        this.state.estimated = true;
        if (event.data.taskType !== undefined) {
          this.state.type = TaskType.restore(event.data.taskType);
        }
        break;
      }
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
      case 'task.closed': {
        const last = this.state.parallelMode.at(-1);
        if (last && last.disabledAt === undefined) {
          this.state.parallelMode[this.state.parallelMode.length - 1] = { ...last, disabledAt: event.data.at };
        }
        this.state.status = 'closed';
        this.state.closures.push({
          at: event.data.at,
          outcome: event.data.outcome,
          ...(event.data.spawned === undefined ? {} : { spawned: event.data.spawned }),
        });
        break;
      }
      case 'task.reopened': {
        const last = this.state.closures.at(-1);
        if (last) {
          this.state.closures[this.state.closures.length - 1] = { ...last, reopenedAt: event.ts };
        }
        this.state.status = 'in-progress';
        break;
      }
      case 'task.retro-recorded':
        this.state.retro = { reasons: event.data.reasons, lesson: event.data.lesson, recordedAt: event.ts };
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
      estimate: undefined,
      manualTime: [],
      extras: [],
      parallelMode: [],
      spawnedFrom: event.data.spawnedFrom,
      closures: [],
      retro: undefined,
      lastEventAt: event.ts,
      firstEstimate: undefined,
      estimatedAfterStart: false,
      revisions: [],
      extraRecords: [],
      manualRecordedAt: [],
      lastPartRecordAt: undefined,
    };
  }
}

function later(a: string, b: string): string {
  return Timestamp.parse(b).toMillis() > Timestamp.parse(a).toMillis() ? b : a;
}
