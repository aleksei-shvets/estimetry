import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { Project } from '../../src/domain/project/project.js';
import { ProjectId } from '../../src/domain/project/project-id.js';
import { Author } from '../../src/domain/shared/author.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import { FsProjectLocator } from '../../src/infrastructure/fs/fs-project-locator.js';
import { NodeProjectFiles } from '../../src/infrastructure/fs/node-project-files.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { GitCli } from '../../src/infrastructure/git/git-cli.js';
import { FileProjectRepository } from '../../src/infrastructure/persistence/file-project-repository.js';
import { tempDir } from '../support/temp-dir.js';

/**
 * Paths as macOS gives them (CI runs these on macos-latest): a file system that
 * ignores case, `/tmp` as a symlink to `/private/tmp`, names in another Unicode
 * form, the ctime of a directory moved into the archive. Each case runs where
 * the file system can show it.
 */

/** Whether the file system of the temporary directory ignores case, as APFS does by default. */
function ignoresCase(): boolean {
  const dir = tempDir('case-');
  mkdirSync(join(dir, 'probe'));
  return existsSync(join(dir, 'PROBE'));
}

/** Whether the file system takes both Unicode forms of a name as one, as APFS does. */
function keepsOneUnicodeForm(): boolean {
  const dir = tempDir('nfd-');
  mkdirSync(join(dir, 'é'.normalize('NFC')));
  return existsSync(join(dir, 'é'.normalize('NFD')));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A git repository registered as project `api` at its real path, as `init` registers it. */
function registered(name: string): { readonly home: string; readonly repo: string } {
  const base = tempDir('paths-');
  const repo = join(base, name);
  mkdirSync(repo);
  git(repo, 'init', '-q');
  const home = join(base, 'home');
  const root = new GitCli(repo).currentRoot();
  new FileProjectRepository(new StorageLayout(home)).addIfAbsent(
    Project.register({ id: ProjectId.parse('api'), name: 'api', path: root }, Author.of('dev@example.com'), Timestamp.fromMillis(0)),
  );
  return { home, repo: root };
}

/** The same directory spelled with the case of its last part changed. */
const otherCase = (path: string) => join(path, '..', path.split('/').at(-1)?.toUpperCase() ?? '');

it.runIf(process.platform === 'darwin')('the macOS runner ignores case, so the cases below do run there', () => {
  expect(ignoresCase()).toBe(true);
});

describe.runIf(ignoresCase())('a file system that ignores case', () => {
  it('a hook in the directory spelled in another case finds the project, with the registered root', () => {
    const { home, repo } = registered('Api-Repo');
    const located = new FsProjectLocator(new StorageLayout(home)).locate(join(otherCase(repo), 'src'));
    expect(located?.root).toBe(repo);
  });

  it('the CLI in the directory spelled in another case gets the root it registered', () => {
    const { home, repo } = registered('Api-Repo');
    const root = new GitCli(otherCase(repo)).currentRoot();
    expect(root).toBe(repo);
    expect(new FileProjectRepository(new StorageLayout(home)).findByPath(root)?.id.value).toBe('api');
  });
});

/** A registry written before paths were made real: the path as it was typed. */
function registeredAs(path: string): string {
  const home = join(tempDir('old-'), 'home');
  mkdirSync(home, { recursive: true });
  const project = Project.register({ id: ProjectId.parse('api'), name: 'api', path }, Author.of('dev@example.com'), Timestamp.fromMillis(0));
  writeFileSync(new StorageLayout(home).projectsFile, stringify({ schemaVersion: 1, projects: [project.toSnapshot()] }));
  return home;
}

describe('a path registered before paths were made real', () => {
  it('through a symlink: the hook and the CLI find the project at its real path', () => {
    const repo = join(tempDir('real-'), 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    const link = join(tempDir('link-'), 'repo');
    symlinkSync(repo, link, 'dir');
    const home = registeredAs(link);
    expect(new FsProjectLocator(new StorageLayout(home)).locate(repo)?.root).toBe(repo);
    expect(new FileProjectRepository(new StorageLayout(home)).findByPath(new GitCli(repo).currentRoot())?.id.value).toBe('api');
  });

  it('is made real by the next write of the registry', () => {
    const repo = join(tempDir('real-'), 'repo');
    mkdirSync(repo);
    const link = join(tempDir('link-'), 'repo');
    symlinkSync(repo, link, 'dir');
    const home = registeredAs(link);
    new FileProjectRepository(new StorageLayout(home)).update(ProjectId.parse('api'), (project) => project.withPath('/elsewhere/api'));
    expect(new FileProjectRepository(new StorageLayout(home)).findById(ProjectId.parse('api'))?.paths).toEqual([repo, '/elsewhere/api']);
  });

  it.runIf(ignoresCase())('in another case: the hook and the CLI find the project', () => {
    const repo = join(tempDir('real-'), 'Repo');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    const home = registeredAs(otherCase(repo));
    expect(new FsProjectLocator(new StorageLayout(home)).locate(repo)?.root).toBe(repo);
    expect(new FileProjectRepository(new StorageLayout(home)).findByPath(new GitCli(repo).currentRoot())?.id.value).toBe('api');
  });
});

describe('symlinks and other spellings of the same directory', () => {
  it('a hook in a symlink to the repository finds the project', () => {
    const { home, repo } = registered('linked');
    const link = join(tempDir('link-'), 'to-repo');
    symlinkSync(repo, link, 'dir');
    expect(new FsProjectLocator(new StorageLayout(home)).locate(link)?.root).toBe(repo);
    expect(new GitCli(link).currentRoot()).toBe(repo);
  });

  it.runIf(process.platform === 'darwin')('a hook in /tmp, which macOS keeps in /private/tmp, finds the project', () => {
    const dir = mkdtempSync('/tmp/estimetry-');
    try {
      const repo = join(dir, 'repo');
      mkdirSync(repo);
      git(repo, 'init', '-q');
      const home = join(dir, 'home');
      const root = new GitCli(repo).currentRoot();
      expect(root.startsWith('/private/tmp/')).toBe(true);
      new FileProjectRepository(new StorageLayout(home)).addIfAbsent(
        Project.register({ id: ProjectId.parse('api'), name: 'api', path: root }, Author.of('dev@example.com'), Timestamp.fromMillis(0)),
      );
      expect(new FsProjectLocator(new StorageLayout(home)).locate(repo)?.root).toBe(root);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(keepsOneUnicodeForm())('a name with letters beyond ASCII is found in the other Unicode form', () => {
    const composed = 'проект-é'.normalize('NFC');
    const { home, repo } = registered(composed);
    const decomposed = join(repo, '..', composed.normalize('NFD'));
    expect(new FsProjectLocator(new StorageLayout(home)).locate(decomposed)?.root).toBe(repo);
  });
});

describe('the moment a change is moved into the archive', () => {
  it('is the ctime of the directory after the move, not its creation', async () => {
    const dir = tempDir('archive-');
    mkdirSync(join(dir, 'changes', 'archive'), { recursive: true });
    mkdirSync(join(dir, 'changes', 'auth'));
    writeFileSync(join(dir, 'changes', 'auth', 'tasks.md'), '- [x] a\n');
    const files = new NodeProjectFiles();
    const created = files.changedAt(join(dir, 'changes', 'auth')) ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const before = Date.now();
    renameSync(join(dir, 'changes', 'auth'), join(dir, 'changes', 'archive', '2026-11-12-auth'));
    const moved = files.changedAt(join(dir, 'changes', 'archive', '2026-11-12-auth')) ?? 0;
    expect(moved).toBeGreaterThan(created);
    expect(moved).toBeGreaterThanOrEqual(before - 5);
  });
});
