import type { SessionId } from '../../domain/measurement/session-id.js';
import type { CheckpointRecorded } from '../../domain/progress/progress-records.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { HookKind } from '../contracts/hook-adapter.js';
import type { CheckpointState, CheckpointStatus } from '../ports/checkpoint-state.js';
import type { ErrorReporter } from '../ports/error-reporter.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { MeasurementSettings } from '../ports/measurement-settings.js';
import type { LocatedProject } from '../ports/project-locator.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { journalEntry } from '../shared/journal-entry.js';
import type { CheckpointSnapshot } from './checkpoint-snapshot.js';
import type { TaskId } from '../../domain/task/task-id.js';

/** Calls that run in the background, so a snapshot that runs git does not hold the agent up. */
const WRITES_CHECKPOINTS: ReadonlySet<HookKind> = new Set(['tool-done', 'turn-end']);

/** The task a checkpoint is written for: its project and copy as the session sees them, and its changes. */
export interface CheckpointTask {
  readonly id: TaskId;
  readonly project: LocatedProject;
  /** The changes of the task (`Task.changes`): they pick its working copy. */
  readonly changes?: readonly string[];
}

/** Checkpoints of a session (checkpoints spec) and the reminder they leave for the next prompt. */
export class Checkpoints {
  constructor(
    private readonly state: CheckpointState,
    private readonly journal: Pick<EventJournal, 'appendRecord'>,
    private readonly snapshot: CheckpointSnapshot,
    private readonly settings: MeasurementSettings,
    private readonly errors: ErrorReporter,
    private readonly meta: EventMetaSource,
  ) {}

  /** Records the call; writes a checkpoint when it is due. Returns the state after the call. */
  touch(
    session: SessionId,
    kind: HookKind,
    now: Timestamp,
    task?: CheckpointTask,
  ): CheckpointStatus {
    let status: CheckpointStatus = { ...this.state.read(session), lastSeenAt: now.toISOString() };
    if (task !== undefined && WRITES_CHECKPOINTS.has(kind)) {
      const interval = this.settings.checkpointInterval();
      if (interval.problem !== undefined && !status.configReported) {
        this.errors.report('checkpoints', new Error(interval.problem));
        status = { ...status, configReported: true };
      }
      const last = status.lastAt === undefined ? undefined : Timestamp.parse(status.lastAt).toMillis();
      if (last === undefined || now.toMillis() - last >= interval.minutes * 60_000) {
        this.write(session, now, task);
        status = { ...status, lastAt: now.toISOString(), reminderPending: true };
      }
    }
    this.state.write(session, status);
    return status;
  }

  /** The reminder is handed out once: on the next prompt or session start after a checkpoint. */
  takeReminder(session: SessionId): boolean {
    const status = this.state.read(session);
    if (!status.reminderPending) {
      return false;
    }
    this.state.write(session, { ...status, reminderPending: false });
    return true;
  }

  /** A part of the snapshot that fails stays empty; the checkpoint is still written. */
  private write(session: SessionId, now: Timestamp, task: CheckpointTask): void {
    this.journal.appendRecord(
      journalEntry<CheckpointRecorded>(
        'checkpoint.recorded',
        {
          source: 'estimetry',
          session: session.value,
          ...this.snapshot.take({ project: task.project.id, root: task.project.root, changes: task.changes ?? [] }),
        },
        { ...this.meta.at(now), project: task.project.id, task: task.id },
      ),
    );
  }
}
