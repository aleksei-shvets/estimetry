import { Estimate } from '../estimate/estimate.js';
import type { EstimateRevision } from '../estimate/estimate-revision.js';
import { LostWindow } from '../estimate/lost-window.js';
import { exclusionsOf, type PlanExclusions } from '../progress/plan-exclusions.js';
import { Extra } from '../measurement/extra.js';
import { ManualTime } from '../measurement/manual-time.js';
import type { ParallelModeChange, ParallelPeriod } from '../measurement/parallel-mode.js';
import { Author } from '../shared/author.js';
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
import { closureOf, revisionData, revisionOf, snapshotOf, stateFromSnapshot, type TaskSnapshot } from './task-snapshot.js';
import { later, type ExtraRecord, type ManualRecord, type TaskClosure, type TaskRetro, type TaskRevision, type TaskState } from './task-state.js';

export { TASK_SNAPSHOT_SCHEMA_VERSION, type TaskSnapshot } from './task-snapshot.js';
export type { ExtraRecord, ManualRecord, TaskClosure, TaskRetro, TaskRevision } from './task-state.js';

const MAX_TITLE_LENGTH = 200;

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
    return new Task(stateFromSnapshot(snapshot), snapshot.version, snapshot.lastEventId, snapshot.version);
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

  get isInProgress(): boolean {
    return this.state.status === 'in-progress';
  }

  get isClosed(): boolean {
    return this.state.status === 'closed';
  }

  get projects(): readonly ProjectId[] {
    return this.state.projects;
  }

  /** The project the task was created in. */
  get homeProject(): ProjectId {
    const home = this.state.projects[0];
    if (home === undefined) {
      throw new InvalidValue(`task ${this.state.id.toString()} has no project`);
    }
    return home;
  }

  get version(): number {
    return this.appliedCount;
  }

  get title(): string {
    return this.state.title;
  }

  get type(): TaskType {
    return this.state.type;
  }

  get ticket(): string | undefined {
    return this.state.ticket;
  }

  get author(): Author {
    return this.state.author;
  }

  /** When work started; absent before `start`. */
  get startedAt(): Timestamp | undefined {
    return this.state.startedAt;
  }

  /** When work started, for a task that must have started. */
  requireStartedAt(): Timestamp {
    if (this.state.startedAt === undefined) {
      throw new TaskNotStarted(this.state.id.toString(), this.state.status);
    }
    return this.state.startedAt;
  }

  get estimate(): Estimate | undefined {
    return this.state.estimate;
  }

  get manualTime(): ManualTime[] {
    return this.state.manual.map((record) => record.manual);
  }

  /** The estimate when work started, before any revision; undefined for a task estimated only after its start. */
  get firstEstimate(): Estimate | undefined {
    return this.state.estimatedAfterStart ? undefined : this.originalEstimate;
  }

  /** The estimate before any revision, also for a task estimated only after its start. */
  get originalEstimate(): Estimate | undefined {
    return this.state.firstEstimate ?? this.state.estimate;
  }

  get estimatedAfterStart(): boolean {
    return this.state.estimatedAfterStart;
  }

  /** Task type of the first estimate: what the first number given to the PM was estimated as. */
  get firstType(): TaskType {
    return this.state.revisions[0]?.typeBefore ?? this.state.type;
  }

  get revisions(): readonly TaskRevision[] {
    return this.state.revisions;
  }

  /** The earliest a window of lost work may start: the latest of the start, the previous revision and the last reopening. */
  get lostWindowFloor(): Timestamp | undefined {
    const moments = [this.state.startedAt, this.state.revisions.at(-1)?.at, this.lastReopening].filter((v): v is Timestamp => v !== undefined);
    return moments.length === 0 ? undefined : moments.reduce(later);
  }

  /** Windows of work thrown away by revisions with `exclude`. */
  get lostWindows(): readonly LostWindow[] {
    return this.state.revisions.flatMap((r) => (r.spent === 'exclude' && r.lostFrom !== undefined ? [LostWindow.of(r.lostFrom, r.at)] : []));
  }

  /**
   * What revisions with `exclude` took out of the plan: archived changes by
   * project, and the moment of the last such revision for projects that were
   * not readable then (their archive counts from that day).
   */
  get planExclusions(): PlanExclusions {
    return exclusionsOf(this.state.revisions.map(revisionData));
  }

  /** Extra work with the id and time of its event, for `--covers`. */
  get extraRecords(): readonly ExtraRecord[] {
    return this.state.extras;
  }

  /** Manual time with the moment each record was made. */
  get manualRecords(): readonly ManualRecord[] {
    return this.state.manual;
  }

  get extras(): Extra[] {
    return this.state.extras.map((record) => record.extra);
  }

  get parallelMode(): readonly ParallelPeriod[] {
    return this.state.parallelMode;
  }

  get spawnedFrom(): TaskId | undefined {
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
    return this.closure?.at;
  }

  /** When the task closed, for a task that must be closed. */
  requireClosedAt(): Timestamp {
    const closure = this.closure;
    if (closure === undefined) {
      throw new TaskNotClosed(this.state.id.toString(), this.state.status);
    }
    return closure.at;
  }

  get retro(): TaskRetro | undefined {
    return this.state.retro;
  }

  /** The latest moment the task knows of; closing cannot be earlier. */
  get lastEventAt(): Timestamp {
    return this.state.lastEventAt;
  }

  get isParallel(): boolean {
    return this.state.parallelMode.at(-1)?.disabledAt === undefined && this.state.parallelMode.length > 0;
  }

  private get lastReopening(): Timestamp | undefined {
    return this.state.closures.flatMap((closure) => (closure.reopenedAt === undefined ? [] : [closure.reopenedAt])).at(-1);
  }

  isStartable(): boolean {
    return STARTABLE_STATUSES.includes(this.state.status);
  }

  belongsTo(project: ProjectId): boolean {
    return this.state.projects.some((known) => known.value === project.value);
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
    const recorded = this.state.extras.some(({ extra }) => extra.accounting === 'renegotiated' && extra.toData().spawned === spawned);
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
    if (revision.covers.length > 0 && revision.spent !== 'exclude') {
      throw new InvalidValue('--covers goes only with --spent exclude: with include nothing is lost, and the covered extra work would leave calibration');
    }
    const at = revision.at;
    if (at.toMillis() > meta.at.toMillis()) {
      throw new InvalidValue(`the revision moment must not be in the future (${at.toISOString()})`);
    }
    const parallelEnd = this.state.parallelMode.at(-1)?.disabledAt;
    const floors: [string, Timestamp | undefined][] = [
      ['the start', startedAt],
      ['the previous revision', this.state.revisions.at(-1)?.at],
      ['the last reopening', this.lastReopening],
      ['the end of parallel mode', parallelEnd === undefined ? undefined : Timestamp.parse(parallelEnd)],
      ['the last manual time of an estimate part', this.state.lastPartRecordAt],
    ];
    for (const [what, floor] of floors) {
      if (floor !== undefined && at.toMillis() < floor.toMillis()) {
        throw new InvalidValue(`the revision moment ${at.toISOString()} is before ${what} (${floor.toISOString()})`);
      }
    }
    let lostFrom = revision.lostFrom;
    if (revision.spent === 'exclude') {
      lostFrom ??= this.lostWindowFloor ?? startedAt;
      for (const [what, floor] of floors.slice(0, 3)) {
        if (floor !== undefined && lostFrom.toMillis() < floor.toMillis()) {
          throw new InvalidValue(`--lost-from ${lostFrom.toISOString()} is before ${what} (${floor.toISOString()})`);
        }
      }
      if (lostFrom.toMillis() >= at.toMillis()) {
        throw new InvalidValue('the window of lost work is empty: --lost-from must be before the revision moment');
      }
    }
    const known = new Set(this.state.extras.flatMap((record) => (record.id === undefined ? [] : [record.id])));
    const unknown = revision.covers.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new InvalidValue(`--covers names no extra work of this task: ${unknown.join(', ')}`);
    }
    const covered = new Set(this.state.revisions.filter((r) => r.spent === 'exclude').flatMap((r) => r.covers));
    const twice = revision.covers.filter((id) => covered.has(id));
    if (twice.length > 0) {
      throw new InvalidValue(`--covers names extra work another revision already covers: ${twice.join(', ')}`);
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
    return snapshotOf(this.state, { count: this.appliedCount, lastEventId: this.lastId });
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
    const ts = Timestamp.parse(event.ts);
    const state = this.state;
    state.lastEventAt = later(state.lastEventAt, ts);
    switch (event.type) {
      case 'task.created':
        throw new InvalidValue(`task ${state.id.toString()} is created twice`);
      case 'task.started':
        state.status = 'in-progress';
        state.startedAt = event.data.at === undefined ? ts : Timestamp.parse(event.data.at);
        break;
      case 'task.estimated':
        state.status = 'estimated';
        state.estimated = true;
        state.estimate = Estimate.fromData(event.data.estimate);
        if (event.data.taskType !== undefined) {
          state.type = TaskType.restore(event.data.taskType);
        }
        break;
      case 'task.manual-time-recorded': {
        const manual = ManualTime.fromData(event.data);
        state.manual.push({ manual, recordedAt: ts });
        if (manual.part !== undefined) {
          state.lastPartRecordAt = ts;
        }
        if (manual.at !== undefined) {
          state.lastEventAt = later(state.lastEventAt, manual.at);
        }
        break;
      }
      case 'task.extra-recorded':
        state.extras.push({ id: event.id, at: ts, extra: Extra.fromData(event.data) });
        break;
      case 'task.estimate-revised':
        this.applyRevision(event);
        break;
      case 'task.parallel-mode-enabled':
        state.parallelMode.push({ enabledAt: event.ts, change: event.data });
        break;
      case 'task.parallel-mode-disabled':
        this.endParallelMode(event.ts, true);
        break;
      case 'task.closed':
        this.endParallelMode(event.data.at);
        state.status = 'closed';
        state.closures.push(closureOf({ ...event.data, recordedAt: event.ts }));
        break;
      case 'task.reopened': {
        const last = state.closures.at(-1);
        if (last) {
          state.closures[state.closures.length - 1] = { ...last, reopenedAt: ts };
        }
        state.status = 'in-progress';
        break;
      }
      case 'task.retro-recorded':
        state.retro = { reasons: event.data.reasons, lesson: event.data.lesson, recordedAt: ts };
        break;
      case 'task.attached':
        if (event.project !== undefined && !state.projects.some((project) => project.value === event.project)) {
          state.projects.push(ProjectId.parse(event.project));
        }
        break;
    }
    this.appliedCount += 1;
    this.lastId = event.id;
  }

  /** Ends the last period of parallel mode: a disabling always, the closing of the task only an open one. */
  private endParallelMode(at: string, always = false): void {
    const last = this.state.parallelMode.at(-1);
    if (last && (always || last.disabledAt === undefined)) {
      this.state.parallelMode[this.state.parallelMode.length - 1] = { ...last, disabledAt: at };
    }
  }

  private applyRevision(event: TaskEstimateRevised): void {
    const state = this.state;
    const before = state.estimate;
    const after = Estimate.fromData(event.data.estimate);
    if (before === undefined) {
      state.estimatedAfterStart = true;
    } else {
      state.firstEstimate ??= before;
      state.revisions.push(
        revisionOf({
          id: event.id,
          at: event.data.at,
          ...(event.data.lostFrom === undefined ? {} : { lostFrom: event.data.lostFrom }),
          reason: event.data.reason,
          ...(event.data.category === undefined ? {} : { category: event.data.category }),
          ...(event.data.spent === undefined ? {} : { spent: event.data.spent }),
          baseLikelyBefore: before.baseLikely,
          baseLikelyAfter: after.baseLikely,
          typeBefore: state.type.value,
          typeAfter: event.data.taskType ?? state.type.value,
          covers: [...event.data.covers],
          ...(event.data.excluded === undefined ? {} : { excluded: event.data.excluded }),
        }),
      );
    }
    state.estimate = after;
    state.estimated = true;
    if (event.data.taskType !== undefined) {
      state.type = TaskType.restore(event.data.taskType);
    }
  }

  private static initialState(event: TaskCreated): TaskState {
    const ts = Timestamp.parse(event.ts);
    return {
      id: TaskId.parse(event.task),
      title: event.data.title,
      type: TaskType.restore(event.data.taskType),
      ticket: event.data.ticket,
      status: 'new',
      estimated: false,
      projects: event.project === undefined ? [] : [ProjectId.parse(event.project)],
      author: Author.of(event.author),
      createdAt: ts,
      startedAt: undefined,
      estimate: undefined,
      manual: [],
      extras: [],
      parallelMode: [],
      spawnedFrom: event.data.spawnedFrom === undefined ? undefined : TaskId.parse(event.data.spawnedFrom),
      closures: [],
      retro: undefined,
      lastEventAt: ts,
      firstEstimate: undefined,
      estimatedAfterStart: false,
      revisions: [],
      lastPartRecordAt: undefined,
    };
  }
}
