import type { ActivityEvent } from '../../domain/measurement/activity-events.js';
import type { CommitRecorded } from '../../domain/progress/progress-records.js';
import { fileList } from '../../domain/progress/progress-records.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import { SessionId } from '../../domain/measurement/session-id.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import { isInProgress } from '../../domain/task/task-status.js';
import type { HookAdapter, HookAdapters, HookTranslation } from '../contracts/hook-adapter.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { CheckpointState } from '../ports/checkpoint-state.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import type { Clock } from '../ports/clock.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { GitSnapshots } from '../ports/git-snapshot.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { MeasurementSettings } from '../ports/measurement-settings.js';
import type { ProjectLocator } from '../ports/project-locator.js';
import { servedTasks, type SessionBindings } from '../ports/session-bindings.js';
import type { TaskStatusReader } from '../ports/task-status-reader.js';
import type { ChangeCompletions } from './change-completions.js';
import type { Checkpoints } from './checkpoints.js';
import { cut, MAX_CONTEXT_LENGTH } from './context-limit.js';
import { closeProposalText, ESTIMATE_REMINDER, EXTRA_REMINDER, sessionStartContext, type TaskFact } from './hook-context.js';
import { journalEntry } from '../shared/journal-entry.js';
import type { SessionTask } from './session-task.js';
import type { ImportSessionLogs } from '../task/import-session-logs.js';

/** The git hook `init --track-commits` installs. */
export const GIT_SOURCE = 'git';
const GIT_EVENTS: readonly string[] = ['post-commit'];

export interface HookCall {
  readonly source: string | undefined;
  readonly event: string | undefined;
  /** Raw stdin of the hook. */
  readonly payload: string;
  /** Directory the hook process runs in. */
  readonly cwd: string;
  /** Project root the tool reports in its environment (`CLAUDE_PROJECT_DIR`), if any. */
  readonly projectDir?: string;
}

/** Fact of a task for the status line; loaded only for the session start, where it is needed. */
export interface TaskFacts {
  /** `near` is the working copy of the session. */
  fact(task: string, near?: string): TaskFact | undefined;
}

export interface HookDependencies {
  readonly adapters: HookAdapters;
  readonly locator: ProjectLocator;
  readonly sessionTask: SessionTask;
  readonly checkpoints: Checkpoints;
  readonly completions: Pick<ChangeCompletions, 'check'>;
  readonly journal: EventJournal;
  readonly tasks: TaskStatusReader;
  readonly bindings: SessionBindings;
  readonly checkpointState: CheckpointState;
  readonly git: GitSnapshots;
  readonly settings: MeasurementSettings;
  readonly facts: () => Promise<TaskFacts>;
  readonly proposals: CloseProposals;
  /** Percent and unfinished groups of the task's plan for the proposal text; loaded only when there is one. */
  readonly planOf: () => Promise<{ of(task: string, near: string): { done?: number; unfinished: readonly string[] } }>;
  /** The moment the hook process started: the time of every event it writes. */
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly authors: AuthorProvider;
  /** The importer of session logs; loaded on the session end only. */
  readonly logs?: () => Promise<Pick<ImportSessionLogs, 'execute'>>;
}

/** The session end imports the session's log in the hook itself, within this time (claude-code-hooks spec). */
export const SESSION_END_IMPORT_BUDGET_MS = 5_000;

/**
 * Entry point of installed hooks: turns a call into activity events of the
 * session's task (or of the project when there is none), checkpoints and
 * context for the agent. Returns what the hook prints for the tool, if anything.
 */
export class ReceiveHook {
  constructor(private readonly deps: HookDependencies) {}

  async execute(call: HookCall): Promise<string | undefined> {
    const { source, event } = call;
    if (source === undefined || event === undefined) {
      throw new InvalidValue('hook needs a source and an event, e.g. `estimetry hook claude-code Stop`');
    }
    if (source === GIT_SOURCE) {
      if (!GIT_EVENTS.includes(event)) {
        throw new InvalidValue(`unknown git hook event "${event}"`);
      }
      // The hook passes the sha of its commit; an older hook block passes nothing and `HEAD` is read.
      const sha = call.payload.trim();
      this.recordCommit(call.cwd, /^[0-9a-f]{7,64}$/.test(sha) ? sha : undefined);
      return undefined;
    }
    const adapter = this.deps.adapters.get(source);
    if (adapter === undefined) {
      throw new InvalidValue(`unknown hook source "${source}"`);
    }
    if (!adapter.hookEvents.includes(event)) {
      throw new InvalidValue(`unknown ${source} hook event "${event}"`);
    }
    return this.receive(adapter, event, call);
  }

  private async receive(adapter: HookAdapter, event: string, call: HookCall): Promise<string | undefined> {
    let payload: unknown;
    try {
      payload = JSON.parse(call.payload);
    } catch {
      throw new InvalidValue(`${adapter.id} ${event}: stdin is not JSON`); // its content is never repeated
    }
    const translation = adapter.translate(event, payload);
    const now = this.deps.clock.now();
    const located = this.deps.locator.locate(call.projectDir ?? translation.cwd ?? call.cwd);
    const resolved = this.deps.sessionTask.resolve(translation.session, located, translation.kind, now);
    if (resolved === undefined) {
      return undefined; // not an estimetry project
    }
    this.write(adapter, translation, now, resolved.project.id, resolved.task?.id);
    if (translation.transcript !== undefined && (translation.kind === 'session-start' || translation.kind === 'session-end')) {
      this.keepTranscript(translation.session, translation.transcript);
    }
    this.deps.checkpoints.touch(
      translation.session,
      translation.kind,
      now,
      resolved.task === undefined ? undefined : { id: resolved.task.id, project: resolved.project },
    );
    if (resolved.task !== undefined) {
      this.deps.completions.check(resolved.task, now, resolved.project.root, translation.session.value);
    }

    if (translation.kind === 'session-start') {
      const fact = resolved.task === undefined ? undefined : (await this.deps.facts()).fact(resolved.task.id, resolved.project.root);
      const reminder = this.deps.checkpoints.takeReminder(translation.session);
      const proposal = resolved.task === undefined ? undefined : await this.proposal(resolved.task.id, translation.session, resolved.project.root, now);
      // The reminder of estimate mode and a proposal go first; the status line gets what is left of the limit.
      const before = [ESTIMATE_REMINDER, ...(proposal === undefined ? [] : [proposal])].join('\n').length + 1;
      const text = sessionStartContext({
        budget: MAX_CONTEXT_LENGTH - before,
        session: translation.session,
        ...(resolved.task === undefined ? {} : { task: resolved.task }),
        ...(fact === undefined ? {} : { fact }),
        candidates: resolved.candidates,
      });
      // The reminder of estimate mode goes first, so the length limit never cuts it.
      const lines = [ESTIMATE_REMINDER, ...(proposal === undefined ? [] : [proposal]), text, ...(reminder && resolved.task === undefined ? [EXTRA_REMINDER] : [])];
      return adapter.renderContext(event, cut(lines.join('\n')));
    }
    if (translation.kind === 'session-end') {
      await this.importLog(adapter.id, translation);
      return undefined;
    }
    if (translation.kind === 'prompt') {
      const proposal = resolved.task === undefined ? undefined : await this.proposal(resolved.task.id, translation.session, resolved.project.root, now);
      const reminder = this.deps.checkpoints.takeReminder(translation.session);
      const lines = [...(proposal === undefined ? [] : [proposal]), ...(reminder ? [EXTRA_REMINDER] : [])];
      return lines.length === 0 ? undefined : adapter.renderContext(event, cut(lines.join('\n')));
    }
    return undefined;
  }

  /** The path of the session's log, for imports outside the tool's environment. */
  private keepTranscript(session: SessionId, transcript: string): void {
    this.deps.bindings.update(session, (current) => (current === undefined || current.transcript === transcript ? undefined : { ...current, transcript }));
  }

  /**
   * The log of an ended session goes into every task in progress it served.
   * Past the budget the import gives up; the closing of the task catches up.
   */
  private async importLog(source: string, translation: HookTranslation): Promise<void> {
    if (this.deps.logs === undefined) {
      return;
    }
    const binding = this.deps.bindings.get(translation.session);
    const tasks = servedTasks(binding).flatMap((id) => {
      const summary = this.deps.tasks.summary(id);
      return summary !== undefined && isInProgress(summary.status) ? [{ id, project: summary.projects[0] ?? binding?.project ?? '' }] : [];
    });
    if (tasks.length === 0) {
      return;
    }
    const path = translation.transcript ?? binding?.transcript;
    (await this.deps.logs()).execute({
      session: translation.session.value,
      source,
      ...(path === undefined ? {} : { path }),
      tasks,
      budgetMs: SESSION_END_IMPORT_BUDGET_MS,
    });
  }

  /**
   * The pending proposal to close the task, taken exactly once. The session
   * that noticed the completion gets it first; another one only when that
   * session has been idle longer than the threshold.
   */
  private async proposal(task: string, session: SessionId, root: string, now: Timestamp): Promise<string | undefined> {
    const pending = this.deps.proposals.peek(task);
    if (pending === undefined) {
      return undefined;
    }
    if (pending.session !== session.value) {
      const seen = this.lastSeen(pending.session);
      if (seen !== undefined && now.toMillis() - seen <= this.deps.settings.idlePolicy().threshold.millis) {
        return undefined;
      }
    }
    const taken = this.deps.proposals.take(task);
    if (taken === undefined) {
      return undefined;
    }
    let plan: { done?: number; unfinished: readonly string[] } = { unfinished: [] };
    try {
      plan = (await this.deps.planOf()).of(task, root);
    } catch {
      // The proposal goes without the plan rather than not at all.
    }
    return closeProposalText({
      task,
      change: taken.change,
      completedAt: taken.completedAt,
      ...(plan.done === undefined ? {} : { planDone: plan.done }),
      unfinished: plan.unfinished,
    });
  }

  private write(adapter: HookAdapter, translation: HookTranslation, now: Timestamp, project: string, task: string | undefined): void {
    for (const draft of translation.events) {
      const entry = journalEntry<ActivityEvent>(draft.type, { ...draft.data, source: adapter.id, session: translation.session.value }, {
        id: this.deps.ids.next(),
        at: now,
        author: this.deps.authors.current(),
        project,
        ...(task === undefined ? {} : { task }),
      });
      if (task === undefined) {
        this.deps.journal.appendUnassigned(project, entry);
      } else {
        this.deps.journal.append(entry);
      }
    }
  }

  /**
   * The task of a commit: the only task in progress of the project, else the
   * task of its session that was active last, within the idle threshold.
   */
  private recordCommit(cwd: string, sha: string | undefined): void {
    const project = this.deps.locator.locate(cwd);
    if (project === undefined) {
      return;
    }
    const commit = this.deps.git.commit(project.root, sha);
    if (commit === undefined) {
      return;
    }
    const now = this.deps.clock.now();
    const task = this.commitTask(project.id, now);
    const record = journalEntry<CommitRecorded>(
      'commit.recorded',
      {
        source: GIT_SOURCE,
        sha: commit.sha,
        parents: commit.parents,
        ...(commit.patchId === undefined ? {} : { patchId: commit.patchId }),
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        ...fileList(commit.files),
      },
      { id: this.deps.ids.next(), at: now, author: this.deps.authors.current(), project: project.id, ...(task === undefined ? {} : { task }) },
    );
    if (task === undefined) {
      this.deps.journal.appendUnassigned(project.id, record);
    } else {
      this.deps.journal.appendRecord(record);
    }
  }

  private commitTask(project: string, now: Timestamp): string | undefined {
    const idle = this.deps.settings.idlePolicy().threshold.millis;
    // A commit right after closing belongs to the closed task, never to another one.
    const latest = this.deps.bindings
      .ofProject(project)
      .map((binding) => ({ binding, seen: this.lastSeen(binding.session) }))
      .filter(({ seen }) => seen !== undefined && now.toMillis() - seen <= idle)
      .sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0))[0];
    if (latest !== undefined && latest.binding.task === undefined && latest.binding.closedTask !== undefined) {
      return undefined;
    }
    const inProgress = this.deps.tasks.inProgress(project);
    if (inProgress.length === 1) {
      return inProgress[0]?.id;
    }
    const active = this.deps.bindings
      .ofProject(project)
      .filter((binding) => binding.task !== undefined && inProgress.some((task) => task.id === binding.task))
      .map((binding) => ({ binding, seen: this.lastSeen(binding.session) }))
      .filter(({ seen }) => seen !== undefined && now.toMillis() - seen <= idle)
      .sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0));
    return active[0]?.binding.task;
  }

  private lastSeen(session: string): number | undefined {
    try {
      const seen = this.deps.checkpointState.read(SessionId.parse(session)).lastSeenAt;
      return seen === undefined ? undefined : Timestamp.parse(seen).toMillis();
    } catch {
      return undefined;
    }
  }
}
