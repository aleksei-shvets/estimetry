import { fileList, type CommitRecorded } from '../../domain/progress/progress-records.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { CommitHookAdapter, CommitNotice } from '../contracts/hook-adapter.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { GitSnapshots } from '../ports/git-snapshot.js';
import type { ProjectLocator } from '../ports/project-locator.js';
import type { SessionBindings } from '../ports/session-bindings.js';
import type { TaskStatusReader } from '../ports/task-status-reader.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { journalEntry } from '../shared/journal-entry.js';
import type { RecentSessions } from './recent-sessions.js';

/**
 * The task of a commit (commit-tracking spec): the only task in progress of
 * the project, else the task of its session that was active last, within the
 * idle threshold.
 */
export class CommitTask {
  constructor(
    private readonly bindings: Pick<SessionBindings, 'ofProject'>,
    private readonly tasks: Pick<TaskStatusReader, 'inProgress'>,
    private readonly recent: RecentSessions,
  ) {}

  of(project: string, now: Timestamp): string | undefined {
    // A commit right after closing belongs to the closed task, never to another one.
    const latest = this.bindings
      .ofProject(project)
      .map((binding) => ({ binding, seen: this.recent.lastSeen(binding.session) }))
      .filter(({ seen }) => this.recent.isRecent(seen, now))
      .sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0))[0];
    if (latest !== undefined && latest.binding.task === undefined && latest.binding.closedTask !== undefined) {
      return undefined;
    }
    const inProgress = this.tasks.inProgress(project);
    if (inProgress.length === 1) {
      return inProgress[0]?.id;
    }
    const active = this.bindings
      .ofProject(project)
      .filter((binding) => binding.task !== undefined && inProgress.some((task) => task.id === binding.task))
      .map((binding) => ({ binding, seen: this.recent.lastSeen(binding.session) }))
      .filter(({ seen }) => this.recent.isRecent(seen, now))
      .sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0));
    return active[0]?.binding.task;
  }
}

/** Records the commit a hook names: into the journal of its task, or of its project when it has none. */
export class CommitRecords {
  constructor(
    private readonly locator: Pick<ProjectLocator, 'locate'>,
    private readonly git: Pick<GitSnapshots, 'commit'>,
    private readonly task: CommitTask,
    private readonly journal: Pick<EventJournal, 'appendRecord' | 'appendUnassigned'>,
    private readonly meta: EventMetaSource,
  ) {}

  /** `now` is the moment the hook started; nothing is written outside an estimetry project or without the commit. */
  record(source: CommitHookAdapter, notice: CommitNotice, cwd: string, now: Timestamp): void {
    const project = this.locator.locate(cwd);
    if (project === undefined) {
      return;
    }
    const commit = this.git.commit(project.root, notice.sha);
    if (commit === undefined) {
      return;
    }
    const task = this.task.of(project.id, now);
    const record = journalEntry<CommitRecorded>(
      'commit.recorded',
      {
        source: source.id,
        sha: commit.sha,
        parents: commit.parents,
        ...(commit.patchId === undefined ? {} : { patchId: commit.patchId }),
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        ...fileList(commit.files),
      },
      { ...this.meta.at(now), project: project.id, ...(task === undefined ? {} : { task }) },
    );
    if (task === undefined) {
      this.journal.appendUnassigned(project.id, record);
    } else {
      this.journal.appendRecord(record);
    }
  }
}
