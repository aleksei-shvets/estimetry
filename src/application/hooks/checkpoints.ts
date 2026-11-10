import type { SessionId } from '../../domain/measurement/session-id.js';
import { fileList, type CheckpointRecorded } from '../../domain/progress/progress-records.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { HookKind } from '../contracts/hook-adapter.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { CheckpointState, CheckpointStatus } from '../ports/checkpoint-state.js';
import type { ErrorReporter } from '../ports/error-reporter.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { GitHead, GitSnapshots } from '../ports/git-snapshot.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { MeasurementSettings } from '../ports/measurement-settings.js';
import type { LocatedProject } from '../ports/project-locator.js';
import type { ProjectPlans } from '../ports/project-plans.js';
import { journalEntry } from '../shared/journal-entry.js';

/** Calls that run in the background, so a snapshot that runs git does not hold the agent up. */
const WRITES_CHECKPOINTS: ReadonlySet<HookKind> = new Set(['tool-done', 'turn-end']);

/** Checkpoints of a session (checkpoints spec) and the reminder they leave for the next prompt. */
export class Checkpoints {
  constructor(
    private readonly state: CheckpointState,
    private readonly journal: EventJournal,
    private readonly plans: ProjectPlans,
    private readonly head: GitHead,
    private readonly git: GitSnapshots,
    private readonly settings: MeasurementSettings,
    private readonly errors: ErrorReporter,
    private readonly ids: IdGenerator,
    private readonly authors: AuthorProvider,
  ) {}

  /** Records the call; writes a checkpoint when it is due. Returns the state after the call. */
  touch(session: SessionId, kind: HookKind, now: Timestamp, task?: { readonly id: string; readonly project: LocatedProject }): CheckpointStatus {
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
  private write(session: SessionId, now: Timestamp, task: { readonly id: string; readonly project: LocatedProject }): void {
    const root = task.project.root;
    const plan = attempt(() => this.plans.plan(root));
    const head = attempt(() => this.head.head(root));
    const tree = head === undefined ? undefined : attempt(() => this.git.workingTree(root));
    this.journal.appendRecord(
      journalEntry<CheckpointRecorded>(
        'checkpoint.recorded',
        {
          source: 'estimetry',
          session: session.value,
          ...(plan === undefined ? {} : { plan }),
          ...(head === undefined ? {} : { head }),
          ...(tree === undefined ? {} : { workingTree: { ...fileList(tree.files), untracked: tree.untracked } }),
        },
        { id: this.ids.next(), at: now, author: this.authors.current(), project: task.project.id, task: task.id },
      ),
    );
  }
}

function attempt<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
