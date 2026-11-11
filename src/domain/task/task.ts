import type { Estimate } from '../estimate/estimate.js';
import type { EstimateRevision } from '../estimate/estimate-revision.js';
import type { LostWindow } from '../estimate/lost-window.js';
import { exclusionsOf, type PlanExclusions } from '../progress/plan-exclusions.js';
import { Extra } from '../measurement/extra.js';
import type { ManualTime } from '../measurement/manual-time.js';
import type { ParallelModeChange, ParallelPeriod } from '../measurement/parallel-mode.js';
import type { Author } from '../shared/author.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { EventMeta } from '../shared/event-envelope.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { ProjectId } from '../project/project-id.js';
import { EstimateLocked, InvalidTransition, TaskClosed, TaskNotClosed, TaskNotStarted } from './task-errors.js';
import { taskEvent, type TaskCreated, type TaskEvent } from './task-events.js';
import { applyEvent } from './task-apply.js';
import { TaskEventLog } from './task-event-log.js';
import { createdData, type NewTask } from './task-creation.js';
import { retroData } from './task-retro.js';
import { checkManualTime, checkParallelSwitch, isParallel } from './task-work-records.js';
import type { TaskId } from './task-id.js';
import { STARTABLE_STATUSES, type TaskStatus } from './task-status.js';
import type { TaskType } from './task-type.js';
import { revisionData, snapshotOf, stateFromSnapshot, type TaskSnapshot } from './task-snapshot.js';
import { initialState, type ExtraRecord, type ManualRecord, type TaskClosure, type TaskRetro, type TaskRevision, type TaskState } from './task-state.js';
import { checkClosingMoment, closedData, lastReopening, type ClosingInput } from './task-closures.js';
import { lostWindowFloor, lostWindowsOf, revisedData } from './task-revisions.js';

export { TASK_SNAPSHOT_SCHEMA_VERSION, type TaskSnapshot } from './task-snapshot.js';
export type { ExtraRecord, ManualRecord, TaskClosure, TaskRetro, TaskRevision } from './task-state.js';

/** The event of a task with the given type. */
type EventOf<T extends TaskEvent['type']> = Extract<TaskEvent, { type: T }>;

/**
 * Aggregate root of the task lifecycle. Every state change goes through
 * `apply`, so a task rebuilt from its journal equals the one restored from a
 * snapshot. New events wait in the event log until the repository pulls them.
 */
export class Task {
  private constructor(
    private state: TaskState,
    private readonly log: TaskEventLog,
    /** Version the task had when it was loaded; the repository checks it on save. */
    readonly loadedVersion: number,
  ) {}

  static create(input: NewTask, meta: EventMeta): Task {
    const event = taskEvent<TaskCreated>('task.created', input.id, input.project.value, createdData(input), meta);
    const task = new Task(initialState(event), new TaskEventLog(1, event.id), 0);
    task.log.hold(event);
    return task;
  }

  static fromEvents(events: readonly TaskEvent[]): Task {
    const [first, ...rest] = events;
    if (first?.type !== 'task.created') {
      throw new InvalidValue('task journal must start with task.created');
    }
    const task = new Task(initialState(first), new TaskEventLog(1, first.id), events.length);
    for (const event of rest) {
      task.apply(event);
    }
    return task;
  }

  static rehydrate(snapshot: TaskSnapshot): Task {
    return new Task(stateFromSnapshot(snapshot), new TaskEventLog(snapshot.version, snapshot.lastEventId), snapshot.version);
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
    return this.log.count;
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
    return lostWindowFloor(this.state, lastReopening(this.state));
  }

  /** Windows of work thrown away by revisions with `exclude`. */
  get lostWindows(): readonly LostWindow[] {
    return lostWindowsOf(this.state);
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
    return isParallel(this.state);
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
    this.emit('task.started', { estimated: this.state.estimated, ...(at === undefined ? {} : { at: at.toISOString() }) }, meta, project);
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
    this.emit('task.estimated', { estimate: estimate.toData(), ...(type === undefined ? {} : { taskType: type.value }) }, meta);
  }

  recordManualTime(manual: ManualTime, meta: EventMeta): void {
    checkManualTime(this.estimate, manual, this.requireInProgress(), meta.at);
    this.emit('task.manual-time-recorded', manual.toData(), meta);
  }

  recordExtra(extra: Extra, meta: EventMeta): void {
    this.requireInProgress();
    this.emit('task.extra-recorded', extra.toData(), meta);
  }

  enableParallelMode(change: ParallelModeChange, meta: EventMeta): void {
    this.requireInProgress();
    checkParallelSwitch(this.state, true, change);
    this.emit('task.parallel-mode-enabled', change.toData(), meta);
  }

  disableParallelMode(meta: EventMeta): void {
    this.requireInProgress();
    checkParallelSwitch(this.state, false);
    this.emit('task.parallel-mode-disabled', {}, meta);
  }

  /** Connects the task to another project. Returns false if it was already connected. */
  attach(project: ProjectId, meta: EventMeta): boolean {
    this.rejectClosed();
    if (this.belongsTo(project)) {
      return false;
    }
    this.emit('task.attached', {}, meta, project);
    return true;
  }

  /** Throws what `close` would throw before the moment is known: a closed or unstarted task. */
  assertCanClose(): void {
    this.requireInProgress();
  }

  /** Ends the work on the task at `at`; the moment is checked by `checkClosingMoment`. */
  close(input: ClosingInput, meta: EventMeta): void {
    checkClosingMoment(this.state, this.requireInProgress(), input.at, meta.at);
    this.emit('task.closed', closedData(input), meta);
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
    checkClosingMoment(this.state, this.requireInProgress(), input.at, first.at);
    const spawned = input.spawned.toString();
    const recorded = this.state.extras.some(({ extra }) => extra.accounting === 'renegotiated' && extra.toData().spawned === spawned);
    if (!recorded) {
      this.recordExtra(Extra.renegotiated({ category: input.category, description: input.description, spawned }), first);
    }
    this.emit('task.closed', closedData({ at: input.at, outcome: 'renegotiated', spawned: input.spawned }), meta.next());
  }

  reopen(meta: EventMeta): void {
    if (this.state.status !== 'closed') {
      throw new InvalidTransition(this.state.id.toString(), this.state.status, 'reopen');
    }
    this.emit('task.reopened', {}, meta);
  }

  /** The retro of a closed task; reasons and the lesson are checked by `retroData`. */
  recordRetro(reasons: readonly string[], lesson: string, meta: EventMeta): void {
    if (this.state.status !== 'closed') {
      throw new TaskNotClosed(this.state.id.toString(), this.state.status);
    }
    this.emit('task.retro-recorded', retroData(this.estimate, reasons, lesson), meta);
  }

  /** A new estimate of a task in progress (estimate-revision spec), checked by `revisedData`. */
  reviseEstimate(revision: EstimateRevision, meta: EventMeta): void {
    const startedAt = this.requireInProgress();
    if (this.isParallel) {
      throw new InvalidValue('parallel mode refers to parts of the current estimate; switch it off first with `emt parallel off`');
    }
    const data = revisedData(this.state, revision, { startedAt, now: meta.at, lastReopening: lastReopening(this.state) });
    this.emit('task.estimate-revised', data, meta);
  }

  pullEvents(): TaskEvent[] {
    return this.log.pull();
  }

  toSnapshot(): TaskSnapshot {
    return snapshotOf(this.state, { count: this.log.count, lastEventId: this.log.lastEventId });
  }

  private rejectClosed(): void {
    if (this.state.status === 'closed') {
      throw new TaskClosed(this.state.id.toString());
    }
  }

  private requireInProgress(): Timestamp {
    this.rejectClosed();
    const startedAt = this.startedAt;
    if (this.state.status !== 'in-progress' || startedAt === undefined) {
      throw new TaskNotStarted(this.state.id.toString(), this.state.status);
    }
    return startedAt;
  }

  /** Records an event of the task, in its home project unless another is named: applied now, pulled by the repository later. */
  private emit<T extends TaskEvent['type']>(type: T, data: EventOf<T>['data'], meta: EventMeta, project = this.homeProject): void {
    // TypeScript does not narrow `T` to the type of its own event; the pair is checked at the call.
    const event = taskEvent<EventOf<T>>(type as EventOf<T>['type'], this.state.id, project.value, data, meta);
    this.apply(event);
    this.log.hold(event);
  }

  private apply(event: TaskEvent): void {
    applyEvent(this.state, event);
    this.log.noteApplied(event);
  }
}
