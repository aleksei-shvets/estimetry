import { exclusionsOf } from '../../src/domain/progress/plan-exclusions.js';
import type { TaskRevisionData } from '../../src/domain/task/task-snapshot.js';
import type { TaskStatus } from '../../src/domain/task/task-status.js';
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
import { ProjectId } from '../../src/domain/project/project-id.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import { TaskId } from '../../src/domain/task/task-id.js';
import type { SessionImportRequest } from '../../src/application/task/import-session-logs.js';

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
  readonly kind = 'session';
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

  ofProject(project: ProjectId): SessionBinding[] {
    return [...this.bindings.values()].filter((binding) => binding.project.equals(project));
  }

  /** A binding from plain values, as a test writes it. */
  setPlain(binding: PlainBinding): void {
    this.bindings.set(binding.session, bindingOf(binding));
  }

  /** The binding of a session in plain values, for assertions. */
  plain(session: string): PlainBinding | undefined {
    const binding = this.bindings.get(session);
    return binding === undefined ? undefined : plainOf(binding);
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
    return match === undefined ? undefined : { id: ProjectId.parse(this.projects[match] as string), root: match };
  }
}

/** Task summaries straight from the in-memory repository, as the real reader takes them from snapshots. */
export class RepositoryTaskStatusReader implements TaskStatusReader {
  constructor(private readonly tasks: TaskRepository) {}

  summary(task: TaskId): TaskSummary | undefined {
    const found = this.tasks.listAll().find((t) => t.id.equals(task));
    return found ? toSummary(found.toSnapshot()) : undefined;
  }

  inProgress(project: ProjectId): TaskSummary[] {
    return this.tasks
      .listAll()
      .map((t) => toSummary(t.toSnapshot()))
      .filter((t) => t.status === 'in-progress' && t.projects.some((known) => known.equals(project)));
  }
}

function toSummary(s: { id: string; title: string; status: TaskStatus; startedAt?: string; projects: readonly string[]; revisions?: readonly TaskRevisionData[] }): TaskSummary {
  const excluding = (s.revisions ?? []).some((revision) => revision.spent === 'exclude');
  return {
    id: TaskId.parse(s.id),
    title: s.title,
    status: s.status,
    projects: s.projects.map((project) => ProjectId.parse(project)),
    ...(s.startedAt === undefined ? {} : { startedAt: Timestamp.parse(s.startedAt) }),
    ...(excluding ? { exclusions: exclusionsOf(s.revisions ?? []) } : {}),
  };
}

export class FakeProjectPlans implements ProjectPlans {
  constructor(public changes: readonly ChangeProgress[] | undefined = [{ change: 'a', archived: false, done: 1, total: 4 }]) {}

  /** Readings with the project as plain text, as a test writes them. */
  readings: PlainReading[] = [];
  /** The working copy of every read, in order: undefined when none was given. */
  readonly nears: (string | undefined)[] = [];

  plan(): readonly ChangeProgress[] | undefined {
    return this.changes;
  }

  plans(projects: readonly ProjectId[], options: { readonly near?: string } = {}): ProjectPlanReading[] {
    this.nears.push(options.near);
    return projects.map((project) => {
      const found = this.readings.find((reading) => reading.project === project.value);
      return found === undefined ? { project, unavailable: 'not-on-this-machine' } : { ...found, project };
    });
  }

  archives(projects: readonly ProjectId[], options: { readonly near?: string } = {}): ProjectPlanReading[] {
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
  /** The sha of each commit asked for; undefined for `HEAD`. */
  readonly commitsAsked: (string | undefined)[] = [];

  head(): string | undefined {
    return this.headSha;
  }

  workingTree(): { files: readonly FileLines[]; untracked: number } | undefined {
    this.workingTreeCalls += 1;
    return this.tree;
  }

  commit(_root: string, sha?: string): CommitInfo | undefined {
    this.commitsAsked.push(sha);
    return this.lastCommit;
  }
}

/** A reading of a plan with the project as plain text. */
export type PlainReading = Omit<ProjectPlanReading, 'project'> & { readonly project: string };

/** A session binding in plain values: what a test writes and compares. */
export interface PlainBinding {
  readonly session: string;
  readonly project: string;
  readonly root: string;
  readonly task?: string;
  readonly since?: string;
  readonly checkedAt?: string;
  readonly everBound?: boolean;
  readonly closedTask?: string;
  readonly tasks?: readonly string[];
  readonly transcript?: string;
}

export function bindingOf(p: PlainBinding): SessionBinding {
  return {
    session: SessionId.parse(p.session),
    project: ProjectId.parse(p.project),
    root: p.root,
    ...(p.task === undefined ? {} : { task: TaskId.parse(p.task) }),
    ...(p.since === undefined ? {} : { since: Timestamp.parse(p.since) }),
    ...(p.checkedAt === undefined ? {} : { checkedAt: Timestamp.parse(p.checkedAt) }),
    ...(p.everBound === undefined ? {} : { everBound: p.everBound }),
    ...(p.closedTask === undefined ? {} : { closedTask: TaskId.parse(p.closedTask) }),
    ...(p.tasks === undefined ? {} : { tasks: p.tasks.map((task) => TaskId.parse(task)) }),
    ...(p.transcript === undefined ? {} : { transcript: p.transcript }),
  };
}

export function plainOf(b: SessionBinding): PlainBinding {
  return {
    session: b.session.value,
    project: b.project.value,
    root: b.root,
    ...(b.task === undefined ? {} : { task: b.task.toString() }),
    ...(b.since === undefined ? {} : { since: b.since.toISOString() }),
    ...(b.checkedAt === undefined ? {} : { checkedAt: b.checkedAt.toISOString() }),
    ...(b.everBound === undefined ? {} : { everBound: b.everBound }),
    ...(b.closedTask === undefined ? {} : { closedTask: b.closedTask.toString() }),
    ...(b.tasks === undefined ? {} : { tasks: b.tasks.map((task) => task.toString()) }),
    ...(b.transcript === undefined ? {} : { transcript: b.transcript }),
  };
}

/** A request to import a session log in plain values, for assertions. */
export function plainImport(request: SessionImportRequest) {
  return {
    ...request,
    session: request.session.value,
    tasks: request.tasks.map((task) => ({ id: task.id.toString(), project: task.project.value })),
  };
}
