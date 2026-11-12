import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readYaml, writeYamlAtomic } from '../../src/infrastructure/fs/atomic-yaml.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { GitCli } from '../../src/infrastructure/git/git-cli.js';
import { YamlConfigStore } from '../../src/infrastructure/persistence/yaml-config-store.js';
import { tempDir } from '../support/temp-dir.js';

function gitRepo(): string {
  const repo = tempDir('repo-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: repo });
  return repo;
}

describe('GitCli', () => {
  it('resolves the git root from a subdirectory', () => {
    const repo = gitRepo();
    mkdirSync(join(repo, 'src', 'lib'), { recursive: true });
    expect(new GitCli(join(repo, 'src', 'lib')).currentRoot()).toBe(repo);
    expect(new GitCli(repo).userEmail()).toBe('dev@example.com');
  });

  it('uses the working directory outside git, without symlinks', () => {
    const dir = tempDir('plain-');
    const link = join(tempDir('link-'), 'notes');
    symlinkSync(dir, link);
    expect(new GitCli(link).currentRoot()).toBe(dir);
  });

  it('names the main working copy of a linked worktree, and none for the main copy or outside git', () => {
    const repo = gitRepo();
    execFileSync('git', ['-c', 'user.name=Dev', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: repo });
    const worktree = join(tempDir('wt-'), 'feature');
    execFileSync('git', ['worktree', 'add', '-q', worktree], { cwd: repo });
    mkdirSync(join(worktree, 'src'));
    const inside = new GitCli(join(worktree, 'src'));
    expect(inside.currentRoot()).toBe(worktree);
    expect(inside.mainRoot()).toBe(repo);
    expect(new GitCli(repo).mainRoot()).toBeUndefined();
    expect(new GitCli(tempDir('plain-')).mainRoot()).toBeUndefined();
  });

  it('a worktree of a bare repository has no main working copy: the folder that holds the repository is none', () => {
    const repo = gitRepo();
    execFileSync('git', ['-c', 'user.name=Dev', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: repo });
    const parent = tempDir('bare-');
    execFileSync('git', ['clone', '-q', '--bare', repo, join(parent, 'repo.git')]);
    execFileSync('git', ['worktree', 'add', '-q', join(parent, 'wt')], { cwd: join(parent, 'repo.git') });
    expect(new GitCli(join(parent, 'wt')).currentRoot()).toBe(join(parent, 'wt'));
    expect(new GitCli(join(parent, 'wt')).mainRoot()).toBeUndefined();
  });
});

describe('YamlConfigStore', () => {
  it('detects the author once and then keeps it', () => {
    const layout = new StorageLayout(tempDir());
    let detections = 0;
    const store = new YamlConfigStore(layout, () => {
      detections += 1;
      return 'dev@example.com';
    });
    expect(store.current().id).toBe('dev@example.com');
    expect(readYaml(layout.configFile)).toEqual({ schemaVersion: 1, author: { id: 'dev@example.com' } });

    const later = new YamlConfigStore(layout, () => 'someone-else');
    expect(later.current().id).toBe('dev@example.com');
    expect(detections).toBe(1);
  });

  it('reads author aliases: strings other than the own id, a non-list as none', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const store = new YamlConfigStore(layout, () => 'x');
    writeYamlAtomic(layout.configFile, { author: { id: 'new@example.com', aliases: ['old@example.com', ' ', 'new@example.com', 7, 'old@example.com'] } });
    expect(store.authorAliases()).toEqual(['old@example.com']);
    writeYamlAtomic(layout.configFile, { author: { id: 'new@example.com', aliases: 'old@example.com' } });
    expect(store.authorAliases()).toEqual([]);
  });

  it('extends the built-in task types from config without creating files on read', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const store = new YamlConfigStore(layout, () => 'x');
    expect(store.allowed()).toContain('research');
    expect(() => readdirSync(layout.root)).toThrow();

    writeYamlAtomic(layout.configFile, { author: { id: 'x' }, taskTypes: ['Spike', 'feature'] });
    expect(store.allowed()).toEqual(['feature', 'integration', 'bugfix', 'refactor', 'infra', 'migration', 'research', 'spike']);
  });
});
