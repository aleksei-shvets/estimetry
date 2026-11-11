import { appendFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project } from '../../src/domain/project/project.js';
import { ProjectId } from '../../src/domain/project/project-id.js';
import { ProjectIdTaken, ProjectNotFound } from '../../src/domain/project/project-repository.js';
import { Author } from '../../src/domain/shared/author.js';
import type { EventMeta } from '../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import { Task } from '../../src/domain/task/task.js';
import { ConcurrencyConflict, TaskNotFound } from '../../src/domain/task/task-errors.js';
import { TaskId } from '../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../src/domain/task/task-type.js';
import { readYaml } from '../../src/infrastructure/fs/atomic-yaml.js';
import { appendJsonLine } from '../../src/infrastructure/fs/jsonl.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { FileProjectRepository } from '../../src/infrastructure/persistence/file-project-repository.js';
import { FileTaskRepository } from '../../src/infrastructure/persistence/file-task-repository.js';
import { ROOT, spawnNode } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

let n = 0;
const meta = (): EventMeta => ({ id: `e-${++n}`, at: Timestamp.fromMillis(1_800_000_000_000 + n), author: Author.of('dev@example.com') });
const api = ProjectId.parse('api');

function setup() {
  const layout = new StorageLayout(join(tempDir(), 'home'));
  return { layout, repo: new FileTaskRepository(layout) };
}

function createTask(repo: FileTaskRepository, title = 'X'): Task {
  const task = Task.create({ id: repo.nextId(), title, type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta());
  repo.save(task);
  return task;
}

describe('FileTaskRepository', () => {
  it('issues sequential ids and reserves them before the snapshot exists', () => {
    const { layout, repo } = setup();
    expect(repo.nextId().toString()).toBe('T-1');
    expect(existsSync(layout.taskJournal('T-1'))).toBe(true);
    expect(repo.nextId().toString()).toBe('T-2');
    expect(repo.find(TaskId.parse('T-1'))).toBeUndefined();
    expect(repo.listAll()).toEqual([]);
  });

  it('saves events then a versioned snapshot, and loads the task back', () => {
    const { layout, repo } = setup();
    createTask(repo);
    const loaded = repo.get(TaskId.parse('T-1'));
    loaded.start(api, meta());
    repo.save(loaded);

    expect(readYaml(layout.taskSnapshot('T-1'))).toMatchObject({ id: 'T-1', status: 'in-progress', version: 2, lastEventId: `e-${n}` });
    expect(repo.get(TaskId.parse('T-1')).toSnapshot()).toEqual(loaded.toSnapshot());
  });

  it('rejects a save based on an outdated version', () => {
    const { repo } = setup();
    createTask(repo);
    const first = repo.get(TaskId.parse('T-1'));
    const second = repo.get(TaskId.parse('T-1'));
    first.start(api, meta());
    repo.save(first);
    second.attach(ProjectId.parse('web'), meta());
    expect(() => repo.save(second)).toThrow(ConcurrencyConflict);
    expect(repo.get(TaskId.parse('T-1')).projects.map((project) => project.value)).toEqual(['api']);
  });

  it('rebuilds the snapshot when the process died between journal and snapshot writes', () => {
    const { layout, repo } = setup();
    const task = createTask(repo);
    task.start(api, meta());
    const [started] = task.pullEvents();
    appendJsonLine(layout.taskJournal('T-1'), started); // journal written, snapshot not

    expect(repo.get(TaskId.parse('T-1')).status).toBe('in-progress');
    expect(readYaml(layout.taskSnapshot('T-1'))).toMatchObject({ status: 'in-progress', version: 2 });
  });

  it('lists a task whose snapshot is missing, and ignores foreign journal records', () => {
    const { layout, repo } = setup();
    createTask(repo, 'A');
    createTask(repo, 'B');
    rmSync(layout.taskSnapshot('T-2'));
    appendJsonLine(layout.taskJournal('T-1'), { schemaVersion: 1, type: 'tool.tick', ts: 'x' });
    appendFileSync(layout.taskJournal('T-1'), '{"torn":');

    expect(repo.listAll().map((t) => t.id.toString())).toEqual(['T-1', 'T-2']);
    expect(repo.listByProject(ProjectId.parse('web'))).toEqual([]);
  });

  it('reports a missing task and creates nothing on reads', () => {
    const { layout, repo } = setup();
    expect(() => repo.get(TaskId.parse('T-9'))).toThrow(TaskNotFound);
    expect(repo.listAll()).toEqual([]);
    expect(existsSync(layout.root)).toBe(false);
  });
});

describe('FileProjectRepository', () => {
  const register = (id: string, path: string) =>
    Project.register({ id: ProjectId.parse(id), name: id, path }, Author.of('dev@example.com'), Timestamp.fromMillis(0));

  it('adds projects and finds them by path', () => {
    const projectDir = tempDir('my-app-');
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const repo = new FileProjectRepository(layout);

    expect(repo.addIfAbsent(register('my-app', projectDir)).id.value).toBe('my-app');
    expect(repo.findByPath(projectDir)?.id.value).toBe('my-app');
    expect([...repo.ids()]).toEqual(['my-app']);
    expect(readdirSync(projectDir)).toEqual([]);
  });

  it('returns the existing owner of a path and refuses a taken id', () => {
    const repo = new FileProjectRepository(new StorageLayout(join(tempDir(), 'home')));
    repo.addIfAbsent(register('my-app', '/a/my-app'));
    expect(repo.addIfAbsent(register('other', '/a/my-app')).id.value).toBe('my-app');
    expect(() => repo.addIfAbsent(register('my-app', '/b/my-app'))).toThrow(ProjectIdTaken);
  });

  it('updates a project in place and refuses an unknown id', () => {
    const repo = new FileProjectRepository(new StorageLayout(join(tempDir(), 'home')));
    repo.addIfAbsent(register('my-app', '/a/my-app'));
    repo.addIfAbsent(register('notes', '/a/notes'));
    repo.update(ProjectId.parse('my-app'), (p) => p.withStack(['go']).withPath('/b/my-app'));
    expect(repo.findById(ProjectId.parse('my-app'))?.toSnapshot()).toMatchObject({ stack: ['go'], paths: ['/a/my-app', '/b/my-app'] });
    expect(repo.findByPath('/b/my-app')?.id.value).toBe('my-app');
    expect(repo.findById(ProjectId.parse('notes'))).toBeDefined();
    expect(() => repo.update(ProjectId.parse('nope'), (p) => p)).toThrow(ProjectNotFound);
  });

  it('reads a registry written before fingerprints existed', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const repo = new FileProjectRepository(layout);
    repo.addIfAbsent(register('my-app', '/a/my-app'));
    expect(repo.findById(ProjectId.parse('my-app'))?.fingerprint).toBeUndefined();
  });

  it('loses no project when stack updates and registrations run in parallel processes', async () => {
    const home = join(tempDir(), 'home');
    const layout = new StorageLayout(home);
    new FileProjectRepository(layout).addIfAbsent(register('my-app', '/a/my-app'));
    const dist = (path: string) => JSON.stringify(pathToFileURL(join(ROOT, 'dist', path)).href);
    const script = `
      const { FileProjectRepository } = await import(${dist('infrastructure/persistence/file-project-repository.js')});
      const { StorageLayout } = await import(${dist('infrastructure/fs/storage-layout.js')});
      const { Project } = await import(${dist('domain/project/project.js')});
      const { ProjectId } = await import(${dist('domain/project/project-id.js')});
      const { Author } = await import(${dist('domain/shared/author.js')});
      const { Timestamp } = await import(${dist('domain/shared/timestamp.js')});
      const repo = new FileProjectRepository(new StorageLayout(${JSON.stringify(home)}));
      const n = Number(process.argv[1]);
      if (n % 2 === 0) {
        repo.update(ProjectId.parse('my-app'), (p) => p.withStack([...p.stack, 'tag-' + n]));
      } else {
        repo.addIfAbsent(Project.register({ id: ProjectId.parse('p-' + n), name: 'p', path: '/p/' + n }, Author.of('a'), Timestamp.fromMillis(0)));
      }
    `;
    const codes = await Promise.all(Array.from({ length: 10 }, (_, n) => spawnNode(['--input-type=module', '-e', script, String(n)])));
    expect(codes).toEqual(Array(10).fill(0));
    const repo = new FileProjectRepository(layout);
    expect([...repo.ids()].sort()).toEqual(['my-app', 'p-1', 'p-3', 'p-5', 'p-7', 'p-9']);
    expect(repo.findById(ProjectId.parse('my-app'))?.stack).toEqual(['tag-0', 'tag-2', 'tag-4', 'tag-6', 'tag-8']);
  });
});
