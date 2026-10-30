import { beforeEach, describe, expect, it } from 'vitest';
import { ResolveCurrentProject } from '../../../src/application/project/resolve-current-project.js';
import { Project } from '../../../src/domain/project/project.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { FakeAuthorProvider, FakeWorkspaceLocator, FixedClock } from '../../support/fakes.js';
import { InMemoryProjectConfigFile, InMemoryProjectFiles } from '../../support/in-memory-files.js';
import { InMemoryProjectRepository } from '../../support/in-memory-repositories.js';

const REPO = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

let projects: InMemoryProjectRepository;
let files: InMemoryProjectFiles;
let workspace: FakeWorkspaceLocator;
let resolve: ResolveCurrentProject;

function registered(id: string, path: string, fingerprint?: string): void {
  projects.addIfAbsent(
    Project.register(
      { id: ProjectId.parse(id), name: id, path, ...(fingerprint ? { fingerprint } : {}) },
      Author.of('dev@example.com'),
      Timestamp.fromMillis(0),
    ),
  );
}

function at(root: string, fingerprint?: string, config?: string): void {
  workspace.root = root;
  workspace.repository = fingerprint;
  if (config !== undefined) {
    files.write(`${root}/.estimetry/config.yaml`, config);
  }
}

beforeEach(() => {
  projects = new InMemoryProjectRepository();
  files = new InMemoryProjectFiles();
  workspace = new FakeWorkspaceLocator();
  resolve = new ResolveCurrentProject(workspace, projects, new InMemoryProjectConfigFile(files), new FakeAuthorProvider(), new FixedClock());
});

describe('registering the current project', () => {
  it('derives the id from the directory and keeps the fingerprint', () => {
    at('/home/u/my-app', REPO);
    expect(resolve.findOrRegister().toSnapshot()).toMatchObject({ id: 'my-app', paths: ['/home/u/my-app'], fingerprint: REPO });
    expect(files.writes).toEqual([]);
  });

  it('adds a suffix when the name is taken and there is no project config', () => {
    registered('my-app', '/home/u/my-app', REPO);
    at('/other/my-app', REPO);
    expect(resolve.findOrRegister().id.value).toBe('my-app-2');
  });

  it('joins a clone of the same repository to the project named in the config', () => {
    registered('my-app', '/home/u/my-app', REPO);
    at('/home/u/review/my-app-review', REPO, 'project: my-app\n');
    expect(resolve.planRegistration().kind).toBe('join');
    expect(resolve.findOrRegister().paths).toEqual(['/home/u/my-app', '/home/u/review/my-app-review']);
    expect([...projects.ids()]).toEqual(['my-app']);
  });

  it('registers with the configured id when this machine has no such project', () => {
    at('/home/u/clone', REPO, 'project: my-app\n');
    expect(resolve.findOrRegister().id.value).toBe('my-app');
  });

  it('keeps another repository with the same id apart, with a warning for init', () => {
    registered('my-app', '/home/u/my-app', OTHER);
    at('/home/u/their-app', REPO, 'project: my-app\n');
    const plan = resolve.planRegistration();
    expect(plan).toMatchObject({ kind: 'new', warning: expect.stringContaining('registered as my-app-2') });
    expect(resolve.register(plan).id.value).toBe('my-app-2');
    expect(files.read('/home/u/their-app/.estimetry/config.yaml')).toBe('project: my-app\n');
  });

  it('does not join when either side has no fingerprint', () => {
    registered('my-app', '/home/u/my-app');
    at('/home/u/clone', REPO, 'project: my-app\n');
    expect(resolve.findOrRegister().id.value).toBe('my-app-2');
  });

  it('ignores a broken or invalid config', () => {
    at('/home/u/notes', undefined, 'project: [\n');
    expect(resolve.findOrRegister().id.value).toBe('notes');
    at('/home/u/todo', undefined, 'project: Not An Id\n');
    expect(resolve.findOrRegister().id.value).toBe('todo');
  });

  it('plans without writing and finds an already registered path', () => {
    at('/home/u/my-app', REPO, 'project: my-app\n');
    expect(resolve.planRegistration().kind).toBe('new');
    expect([...projects.ids()]).toEqual([]);
    resolve.findOrRegister();
    expect(resolve.planRegistration().kind).toBe('existing');
  });
});
