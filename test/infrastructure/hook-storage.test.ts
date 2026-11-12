import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SessionBinding } from '../../src/application/ports/session-bindings.js';
import { plainOf } from '../support/hook-fakes.js';
import { describe, expect, it } from 'vitest';
import { SessionId } from '../../src/domain/measurement/session-id.js';
import { Project } from '../../src/domain/project/project.js';
import { ProjectId } from '../../src/domain/project/project-id.js';
import { Author } from '../../src/domain/shared/author.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import { Task } from '../../src/domain/task/task.js';
import { TaskId } from '../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../src/domain/task/task-type.js';
import { FsProjectLocator } from '../../src/infrastructure/fs/fs-project-locator.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { FsGitHead } from '../../src/infrastructure/git/fs-git-head.js';
import { GitSnapshotsCli, numstat } from '../../src/infrastructure/git/git-snapshots.js';
import { FileProjectRepository } from '../../src/infrastructure/persistence/file-project-repository.js';
import { FileTaskRepository } from '../../src/infrastructure/persistence/file-task-repository.js';
import { FileTaskStatusReader } from '../../src/infrastructure/persistence/file-task-status-reader.js';
import { JsonlEventJournal } from '../../src/infrastructure/persistence/jsonl-event-journal.js';
import { YamlCheckpointState, YamlSessionStore } from '../../src/infrastructure/persistence/yaml-session-store.js';
import { YamlConfigStore } from '../../src/infrastructure/persistence/yaml-config-store.js';
import { YamlProgressState } from '../../src/infrastructure/persistence/yaml-progress-state.js';
import { NodeProjectFiles } from '../../src/infrastructure/fs/node-project-files.js';
import { ROOT, spawnNode } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repo(): string {
  const dir = tempDir('repo-');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'dev@example.com');
  git(dir, 'config', 'user.name', 'Dev');
  return dir;
}
const s1 = SessionId.parse('s1');

describe('YamlSessionStore and YamlCheckpointState', () => {
  it('stores bindings and checkpoint state apart, finds the sessions of a project', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const store = new YamlSessionStore(layout);
    const state = new YamlCheckpointState(layout);
    expect(store.get(s1)).toBeUndefined();
    store.update(s1, () => ({ session: SessionId.parse('s1'), project: ProjectId.parse('api'), root: '/work/api', task: TaskId.parse('T-1'), since: Timestamp.parse('2026-10-27T09:00:00.000Z'), everBound: true }));
    state.write(s1, { lastAt: '2026-10-27T10:00:00.000Z', reminderPending: true, lastSeenAt: '2026-10-27T10:00:00.000Z' });
    expect(plainOf(store.get(s1) as SessionBinding)).toMatchObject({ task: 'T-1', everBound: true });
    expect(state.read(s1)).toEqual({ lastAt: '2026-10-27T10:00:00.000Z', reminderPending: true, lastSeenAt: '2026-10-27T10:00:00.000Z' });
    expect(store.ofProject(ProjectId.parse('api')).map((b) => b.session.value)).toEqual(['s1']);
    expect(store.ofProject(ProjectId.parse('web'))).toEqual([]);
    expect(store.update(s1, () => undefined)?.task?.toString()).toBe('T-1');
    writeFileSync(layout.sessionBinding('s1'), 'session: [');
    expect(store.get(s1)).toBeUndefined();
  });

  it('a binding changed in another process is not undone by checkpoint writes from parallel hooks', async () => {
    const home = join(tempDir(), 'home');
    const layout = new StorageLayout(home);
    new YamlSessionStore(layout).update(s1, () => ({ session: SessionId.parse('s1'), project: ProjectId.parse('api'), root: '/w', task: TaskId.parse('T-1') }));
    const dist = (p: string) => JSON.stringify(pathToFileURL(join(ROOT, 'dist', p)).href);
    const script = `
      const { YamlSessionStore, YamlCheckpointState } = await import(${dist('infrastructure/persistence/yaml-session-store.js')});
      const { StorageLayout } = await import(${dist('infrastructure/fs/storage-layout.js')});
      const { SessionId } = await import(${dist('domain/measurement/session-id.js')});
      const { TaskId } = await import(${dist('domain/task/task-id.js')});
      const layout = new StorageLayout(${JSON.stringify(home)});
      const id = SessionId.parse('s1');
      if (process.argv[1] === '0') {
        new YamlSessionStore(layout).update(id, (b) => ({ ...b, task: TaskId.parse('T-2') }));
      } else {
        for (let i = 0; i < 20; i++) new YamlCheckpointState(layout).write(id, { lastSeenAt: new Date().toISOString() });
      }
    `;
    const codes = await Promise.all(Array.from({ length: 6 }, (_, n) => spawnNode(['--input-type=module', '-e', script, String(n)])));
    expect(codes).toEqual(Array(6).fill(0));
    expect(new YamlSessionStore(layout).get(s1)?.task?.toString()).toBe('T-2');
  });
});

describe('JsonlEventJournal for hooks', () => {
  it('keeps records apart from activity and rotates the journal of sessions without a task', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const journal = new JsonlEventJournal(layout, 300);
    const event = { schemaVersion: 1, id: 'e1', ts: '2026-10-27T10:00:00.000Z', type: 'tool.used', author: 'a', project: 'api', data: { source: 'x', session: 's1' } };
    for (let i = 0; i < 5; i++) {
      journal.appendUnassigned(ProjectId.parse('api'), { ...event, id: `e${i}` } as never);
    }
    expect(journal.readUnassigned(ProjectId.parse('api')).length).toBeLessThan(5);
    expect(readFileSync(layout.unassignedJournal('api').replace('.jsonl', '.1.jsonl'), 'utf8')).toContain('"e0"');
  });

  it('twenty parallel receivers lose no line', async () => {
    const home = join(tempDir(), 'home');
    const dist = (p: string) => JSON.stringify(pathToFileURL(join(ROOT, 'dist', p)).href);
    const script = `
      const { JsonlEventJournal } = await import(${dist('infrastructure/persistence/jsonl-event-journal.js')});
      const { StorageLayout } = await import(${dist('infrastructure/fs/storage-layout.js')});
      const journal = new JsonlEventJournal(new StorageLayout(${JSON.stringify(home)}));
      const w = process.argv[1];
      for (let i = 0; i < 25; i++) journal.append({ schemaVersion: 1, id: w + '-' + i, ts: new Date().toISOString(), type: 'tool.used', author: 'a', task: 'T-1', project: 'api', data: { source: 'x', session: 's' + w } });
    `;
    const codes = await Promise.all(Array.from({ length: 20 }, (_, w) => spawnNode(['--input-type=module', '-e', script, String(w)])));
    expect(codes).toEqual(Array(20).fill(0));
    expect(new JsonlEventJournal(new StorageLayout(home)).readActivity(TaskId.parse('T-1'))).toHaveLength(500);
  });
});

describe('FileTaskStatusReader', () => {
  it('reads status from snapshots and lists the tasks in progress of a project', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const tasks = new FileTaskRepository(layout);
    const meta = (n: number) => ({ id: `m${n}`, at: Timestamp.parse('2026-10-27T10:00:00.000Z'), author: Author.of('a') });
    const api = ProjectId.parse('api');
    const t1 = Task.create({ id: tasks.nextId(), title: 'One', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta(1));
    t1.start(api, meta(2));
    tasks.save(t1);
    const t2 = Task.create({ id: tasks.nextId(), title: 'Two', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta(3));
    tasks.save(t2);
    const reader = new FileTaskStatusReader(layout);
    expect(reader.summary(TaskId.parse('T-1'))).toMatchObject({ title: 'One', status: 'in-progress', projects: [api], id: TaskId.parse('T-1') });
    expect(reader.inProgress(api).map((t) => t.id.toString())).toEqual(['T-1']);
    expect(reader.summary(TaskId.parse('T-9'))).toBeUndefined();
  });
});

describe('FsProjectLocator', () => {
  function registry(paths: Record<string, string>) {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const projects = new FileProjectRepository(layout);
    for (const [id, path] of Object.entries(paths)) {
      projects.addIfAbsent(Project.register({ id: ProjectId.parse(id), name: id, path }, Author.of('a'), Timestamp.fromMillis(0)));
    }
    return new FsProjectLocator(layout);
  }

  it('finds the longest registered ancestor through symlinks and from a git worktree', () => {
    const main = repo();
    git(main, 'commit', '-q', '--allow-empty', '-m', 'x');
    mkdirSync(join(main, 'src', 'deep'), { recursive: true });
    const worktree = join(tempDir('wt-'), 'feature');
    git(main, 'worktree', 'add', '-q', worktree);
    const link = join(tempDir(), 'link');
    symlinkSync(main, link);
    const locator = registry({ app: main, nested: join(main, 'src') });
    expect(locator.locate(join(main, 'src', 'deep'))).toEqual({ id: ProjectId.parse('nested'), root: join(main, 'src') });
    expect(locator.locate(link)).toEqual({ id: ProjectId.parse('app'), root: main });
    expect(locator.locate(worktree)).toEqual({ id: ProjectId.parse('app'), root: main });
    expect(locator.locate(tempDir())).toBeUndefined();
    expect(locator.locate('/does/not/exist')).toBeUndefined();
  });
});

describe('FsGitHead and GitSnapshotsCli', () => {
  it('reads HEAD from loose and packed refs, detached and in a worktree, without git', () => {
    const dir = repo();
    const head = new FsGitHead();
    expect(head.head(dir)).toBeUndefined(); // no commit yet
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'a');
    const sha = git(dir, 'rev-parse', 'HEAD');
    expect(head.head(dir)).toBe(sha);
    git(dir, 'pack-refs', '--all');
    expect(head.head(dir)).toBe(sha);
    const worktree = join(tempDir('wt-'), 'w');
    git(dir, 'worktree', 'add', '-q', worktree);
    expect(head.head(worktree)).toBe(sha);
    git(dir, 'checkout', '-q', '--detach');
    expect(head.head(dir)).toBe(sha);
    expect(head.head(tempDir())).toBeUndefined();
  });

  it('reports changes of the working copy and the last commit with its patch id', () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    writeFileSync(join(dir, 'logo.bin'), Buffer.from([0, 1, 2, 0, 255]));
    git(dir, 'add', 'logo.bin');
    writeFileSync(join(dir, 'new.txt'), 'x\n');
    const snapshots = new GitSnapshotsCli();
    expect(snapshots.workingTree(dir)).toEqual({
      files: [
        { path: 'a.txt', added: 2, deleted: 0 },
        { path: 'logo.bin', added: null, deleted: null },
      ],
      untracked: 1,
    });
    git(dir, 'commit', '-q', '-am', 'second');
    const commit = snapshots.commit(dir);
    expect(commit).toMatchObject({ sha: git(dir, 'rev-parse', 'HEAD'), parents: [git(dir, 'rev-parse', 'HEAD~1')] });
    expect(commit?.patchId).toMatch(/^[0-9a-f]{40}$/);
    expect(commit?.files.map((f) => f.path).sort()).toEqual(['a.txt', 'logo.bin']);
    expect(snapshots.workingTree(tempDir())).toBeUndefined();
    expect(numstat('3\t1\tsrc/x.ts\n-\t-\timg.png\ngarbage')).toEqual([
      { path: 'src/x.ts', added: 3, deleted: 1 },
      { path: 'img.png', added: null, deleted: null },
    ]);
  });
});

describe('YamlConfigStore checkpoint interval', () => {
  it('defaults to 20, accepts 10–30 and reports anything else with the setting name', () => {
    const root = join(tempDir(), 'home');
    mkdirSync(root);
    const store = new YamlConfigStore(new StorageLayout(root), () => 'x');
    expect(store.checkpointInterval()).toEqual({ minutes: 20 });
    writeFileSync(join(root, 'config.yaml'), 'measurement:\n  checkpointMinutes: 15\n');
    expect(store.checkpointInterval()).toEqual({ minutes: 15 });
    writeFileSync(join(root, 'config.yaml'), 'measurement:\n  checkpointMinutes: 45\n');
    expect(store.checkpointInterval()).toMatchObject({ minutes: 20, problem: expect.stringContaining('measurement.checkpointMinutes') });
  });
});

describe('archive listing and the progress cache', () => {
  it('lists subdirectories without a stat, gives the ctime on request, and a missing directory is empty', () => {
    const dir = tempDir('list-');
    mkdirSync(join(dir, 'b'));
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'file.md'), '');
    const before = Date.now() - 1000;
    const files = new NodeProjectFiles();
    expect(files.list(dir)).toEqual(['a', 'b']);
    expect(files.changedAt(join(dir, 'a'))).toBeGreaterThanOrEqual(before);
    expect(files.changedAt(join(dir, 'missing'))).toBeUndefined();
    expect(files.list(join(dir, 'missing'))).toEqual([]);
  });

  it('keeps seen directories per task and treats a broken cache as missing', () => {
    const layout = new StorageLayout(tempDir('progress-'));
    const state = new YamlProgressState(layout);
    expect(state.read(TaskId.parse('T-1'))).toBeUndefined();
    state.write(TaskId.parse('T-1'), { directories: { api: ['2026-11-02-plan-progress'] } });
    expect(state.read(TaskId.parse('T-1'))).toEqual({ directories: { api: ['2026-11-02-plan-progress'] } });
    writeFileSync(layout.taskProgress('T-1'), 'directories: [oops');
    expect(state.read(TaskId.parse('T-1'))).toBeUndefined();
    writeFileSync(layout.taskProgress('T-1'), 'directories: { api: [1] }\n');
    expect(state.read(TaskId.parse('T-1'))).toBeUndefined();
    expect(() => TaskId.parse('../x')).toThrow(); // a path never reaches the store: it is no TaskId
  });
});
