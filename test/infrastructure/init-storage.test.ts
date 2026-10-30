import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { GitCli } from '../../src/infrastructure/git/git-cli.js';
import { GitExcludesFile } from '../../src/infrastructure/git/git-excludes-file.js';
import { YamlConfigStore } from '../../src/infrastructure/persistence/yaml-config-store.js';
import { YamlProjectConfigFile } from '../../src/infrastructure/persistence/yaml-project-config-file.js';
import { FileErrorReporter } from '../../src/infrastructure/system/file-error-reporter.js';
import { PathCommandLocator } from '../../src/infrastructure/system/path-command-locator.js';
import { tempDir } from '../support/temp-dir.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo(): string {
  const dir = tempDir('repo-');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'dev@example.com');
  git(dir, 'config', 'user.name', 'Dev');
  return dir;
}

describe('YamlProjectConfigFile', () => {
  const store = new YamlProjectConfigFile();

  it('reads project and flow, keeps unknown keys when planning, and ignores a broken file', () => {
    const root = tempDir();
    expect(store.read(root)).toEqual({});
    mkdirSync(join(root, '.estimetry'));
    writeFileSync(join(root, '.estimetry', 'config.yaml'), 'project: my-app\nflow: openspec\nnote: shared with the team\n');
    expect(store.read(root)).toEqual({ config: { project: 'my-app', flow: 'openspec' } });
    const change = store.plan(root, { project: 'my-app', flow: 'none' });
    expect(change).toMatchObject({ path: join(root, '.estimetry', 'config.yaml') });
    expect('content' in change ? change.content : '').toBe('project: my-app\nflow: none\nnote: shared with the team\nschemaVersion: 1\n');
    writeFileSync(join(root, '.estimetry', 'config.yaml'), 'project: [\n');
    expect(store.read(root).warning).toMatch(/not valid YAML/);
  });
});

describe('GitCli fingerprint', () => {
  it('is the smallest root commit, the same in a clone, and absent before the first commit', () => {
    const dir = repo();
    expect(new GitCli(dir).fingerprint()).toBeUndefined();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'first');
    const root = git(dir, 'rev-list', '--max-parents=0', 'HEAD');
    expect(new GitCli(dir).fingerprint()).toBe(root);

    const clone = join(tempDir(), 'clone');
    git(dir, 'clone', '-q', dir, clone);
    expect(new GitCli(clone).fingerprint()).toBe(root);
    expect(new GitCli(tempDir()).fingerprint()).toBeUndefined();
  });

  it('picks the smallest of several roots', () => {
    const dir = repo();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'a');
    const first = git(dir, 'branch', '--show-current');
    git(dir, 'checkout', '-q', '--orphan', 'other');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'b');
    git(dir, 'merge', '-q', '--allow-unrelated-histories', '-m', 'm', first);
    const roots = git(dir, 'rev-list', '--max-parents=0', 'HEAD').split('\n').sort();
    expect(roots).toHaveLength(2);
    expect(new GitCli(dir).fingerprint()).toBe(roots[0]);
  });
});

describe('GitExcludesFile', () => {
  it('finds the global excludes and tells whether a path is ignored', () => {
    const home = tempDir('home-');
    const env = { HOME: home, XDG_CONFIG_HOME: '', GIT_CONFIG_GLOBAL: join(home, '.gitconfig') };
    const excludes = new GitExcludesFile(env, home);
    expect(excludes.globalFile()).toBe(join(home, '.config', 'git', 'ignore'));

    const dir = repo();
    expect(excludes.isIgnored(dir, '.claude/settings.local.json')).toBe(false);
    mkdirSync(join(home, '.config', 'git'), { recursive: true });
    writeFileSync(join(home, '.config', 'git', 'ignore'), '**/.claude/settings.local.json\n');
    expect(excludes.isIgnored(dir, '.claude/settings.local.json')).toBe(true);
    expect(excludes.isIgnored(tempDir(), '.claude/settings.local.json')).toBeUndefined();

    writeFileSync(join(home, '.gitconfig'), '[core]\n  excludesFile = ~/my-ignore\n');
    expect(excludes.globalFile()).toBe(join(home, 'my-ignore'));
    expect(new GitExcludesFile({ ...env, GIT_CONFIG_GLOBAL: join(home, 'none'), XDG_CONFIG_HOME: '/xdg' }, home).globalFile()).toBe('/xdg/git/ignore');
  });
});

describe('YamlConfigStore sharing mode', () => {
  it('saves the mode next to the other settings and reads it back', () => {
    const root = join(tempDir(), 'home');
    mkdirSync(root);
    writeFileSync(join(root, 'config.yaml'), 'author:\n  id: dev@example.com\n');
    const config = new YamlConfigStore(new StorageLayout(root), () => 'x');
    expect(config.mode()).toBeUndefined();
    config.save('calibration');
    expect(config.mode()).toBe('calibration');
    expect(readFileSync(join(root, 'config.yaml'), 'utf8')).toContain('id: dev@example.com');
    writeFileSync(join(root, 'config.yaml'), 'sharing:\n  mode: everyone\n');
    expect(config.mode()).toBeUndefined();
  });
});

describe('PathCommandLocator', () => {
  it('finds executables on PATH without running them', () => {
    const bin = tempDir('bin-');
    writeFileSync(join(bin, 'estimetry'), '#!/bin/sh\n');
    chmodSync(join(bin, 'estimetry'), 0o755);
    writeFileSync(join(bin, 'plain'), 'x');
    const locator = new PathCommandLocator({ PATH: `/nope:${bin}` }, 'linux');
    expect(locator.has('estimetry')).toBe(true);
    expect(locator.has('plain')).toBe(false);
    expect(locator.has('missing')).toBe(false);
    writeFileSync(join(bin, 'tool.CMD'), 'x');
    expect(new PathCommandLocator({ PATH: bin, PATHEXT: '.EXE;.CMD' }, 'win32').has('tool')).toBe(true);
  });
});

describe('FileErrorReporter', () => {
  it('moves a log past the limit to errors.log.1 before writing', () => {
    const file = join(tempDir(), 'errors.log');
    writeFileSync(file, 'x'.repeat(200));
    writeFileSync(`${file}.1`, 'older');
    new FileErrorReporter(file, 100).report('hook', new Error('boom'));
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('x'.repeat(200));
    expect(readFileSync(file, 'utf8')).toMatch(/\[hook\] Error: boom/);
    new FileErrorReporter(file, 100).report('hook', new Error('again'));
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(readFileSync(file, 'utf8').match(/Error:/g)?.length).toBeGreaterThan(0);
  });
});
