import { exclusionsOf } from '../../src/domain/progress/plan-exclusions.js';
import type { TaskRevision } from '../../src/domain/task/task.js';
import type { ActivityDraft, HookAdapter, HookKind, HookTranslation } from '../../src/application/contracts/hook-adapter.js';
import type { CheckpointState, CheckpointStatus } from '../../src/application/ports/checkpoint-state.js';
import type { CommitInfo, GitHead, GitSnapshots } from '../../src/application/ports/git-snapshot.js';
import type { LocatedProject, ProjectLocator } from '../../src/application/ports/project-locator.js';
import type { ProjectPlanReading, ProjectPlans } from '../../src/application/ports/project-plans.js';
import { carryOver, type SessionBinding, type SessionBindings } from '../../src/application/ports/session-bindings.js';
import type { TaskStatusReader, TaskSummary } from '../../src/application/ports/task-status-reader.js';
import { SessionId } from '../../src/domain/measurement/session-id.js';
import type { ChangeProgress, FileLines } from '../../src/domain/progress/progress-records.js';
import type { TaskRepository } from '../../src/domain/task/task-repository.js';

/** Payload of the fake tool: the events to write, already normalized. */
export interface FakePayload {
  readonly session: string;
  readonly cwd?: string;
  readonly kind?: HookKind;
  readonly events?: readonly ActivityDraft[];
  readonly transcript?: string;
}

/** A tool whose payload already names the events, so use cases are tested without a real translation. */
export class FakeHookAdapter implements HookAdapter {
  readonly id = 'fake-tool';
  readonly aliases: readonly string[] = ['fake'];
  readonly hookEvents: readonly string[] = ['Start', 'Prompt', 'ToolDone', 'Stop', 'End'];

  translate(_event: string, payload: unknown): HookTranslation {
    const p = payload as FakePayload;
    return {
      session: SessionId.parse(p.session),
      ...(p.cwd === undefined ? {} : { cwd: p.cwd }),
      kind: p.kind ?? 'other',
      events: p.events ?? [],
      ...(p.transcript === undefined ? {} : { transcript: p.transcript }),
    };
  }

  renderContext(event: string, text: string): string {
    return JSON.stringify({ event, text });
  }
}

export class InMemorySessionBindings implements SessionBindings {
  readonly bindings = new Map<string, SessionBinding>();

  get(session: SessionId): SessionBinding | undefined {
    return this.bindings.get(session.value);
  }

  update(session: SessionId, change: (current: SessionBinding | undefined) => SessionBinding | undefined): SessionBinding | undefined {
    const current = this.bindings.get(session.value);
    const changed = change(current);
    if (changed === undefined) {
      return current;
    }
    const next = carryOver(current, changed);
    this.bindings.set(session.value, next);
    return next;
  }

  ofProject(project: string): SessionBinding[] {
    return [...this.bindings.values()].filter((binding) => binding.project === project);
  }
}

export class InMemoryCheckpointState implements CheckpointState {
  readonly states = new Map<string, CheckpointStatus>();

  read(session: SessionId): CheckpointStatus {
    return this.states.get(session.value) ?? {};
  }

  write(session: SessionId, status: CheckpointStatus): void {
    this.states.set(session.value, status);
  }
}

/** Projects by root; a directory belongs to the project with the longest root that contains it. */
export class FakeProjectLocator implements ProjectLocator {
  constructor(readonly projects: Record<string, string> = { '/work/api': 'api' }) {}

  locate(directory: string): LocatedProject | undefined {
    const match = Object.keys(this.projects)
      .filter((root) => directory === root || directory.startsWith(`${root}/`))
      .sort((a, b) => b.length - a.length)[0];
    return match === undefined ? undefined : { id: this.projects[match] as string, root: match };
  }
}

/** Task summaries straight from the in-memory repository, as the real reader takes them from snapshots. */
export class RepositoryTaskStatusReader implements TaskStatusReader {
  constructor(private readonly tasks: TaskRepository) {}

  summary(task: string): TaskSummary | undefined {
    const found = this.tasks.listAll().find((t) => t.id.toString() === task);
    return found ? toSummary(found.toSnapshot()) : undefined;
  }

  inProgress(project: string): TaskSummary[] {
    return this.tasks
      .listAll()
      .map((t) => toSummary(t.toSnapshot()))
      .filter((t) => t.status === 'in-progress' && t.projects.includes(project));
  }
}

function toSummary(s: { id: string; title: string; status: string; startedAt?: string; projects: readonly string[]; revisions?: readonly TaskRevision[] }): TaskSummary {
  const excluding = (s.revisions ?? []).some((revision) => revision.spent === 'exclude');
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    projects: s.projects,
    ...(s.startedAt === undefined ? {} : { startedAt: s.startedAt }),
    ...(excluding ? { exclusions: exclusionsOf(s.revisions ?? []) } : {}),
  };
}

export class FakeProjectPlans implements ProjectPlans {
  constructor(public changes: readonly ChangeProgress[] | undefined = [{ change: 'a', archived: false, done: 1, total: 4 }]) {}

  readings: ProjectPlanReading[] = [];
  /** The working copy of every read, in order: undefined when none was given. */
  readonly nears: (string | undefined)[] = [];

  plan(): readonly ChangeProgress[] | undefined {
    return this.changes;
  }

  plans(projects: readonly string[], options: { readonly near?: string } = {}): ProjectPlanReading[] {
    this.nears.push(options.near);
    return projects.map((project) => this.readings.find((reading) => reading.project === project) ?? { project, unavailable: 'not-on-this-machine' });
  }

  archives(projects: readonly string[], options: { readonly near?: string } = {}): ProjectPlanReading[] {
    return this.plans(projects, options).map(({ changes: _changes, ...rest }) => rest);
  }
}

export class FakeGit implements GitHead, GitSnapshots {
  headSha: string | undefined = 'abc123';
  tree: { files: readonly FileLines[]; untracked: number } | undefined = { files: [{ path: 'src/x.ts', added: 3, deleted: 1 }], untracked: 0 };
  lastCommit: CommitInfo | undefined = {
    sha: 'c0ffee',
    parents: ['abc123'],
    patchId: 'p1d',
    authoredAt: '2026-10-27T10:00:00.000Z',
    committedAt: '2026-10-27T10:00:00.000Z',
    files: [{ path: 'src/a.ts', added: 10, deleted: 2 }],
  };
  workingTreeCalls = 0;

  head(): string | undefined {
    return this.headSha;
  }

  workingTree(): { files: readonly FileLines[]; untracked: number } | undefined {
    this.workingTreeCalls += 1;
    return this.tree;
  }

  commit(): CommitInfo | undefined {
    return this.lastCommit;
  }
}
