import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cliSandbox, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cli.env }).trim();

function gitRepo(name: string, files: Record<string, string> = {}): string {
  const dir = cli.repo(name);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'dev@example.com');
  git(dir, 'config', 'user.name', 'Dev');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

interface Report {
  project: string;
  flow: string;
  tools: string[];
  stack: string[];
  files: { path: string; status: string; reason?: string }[];
  warnings: string[];
}

async function init(cwd: string, ...flags: string[]): Promise<Report> {
  const result = await cli.run(['init', '--no-interactive', '--json', ...flags], cwd, 'estimetry');
  expect(result, result.stderr).toMatchObject({ code: 0 });
  return JSON.parse(result.stdout) as Report;
}

const read = (path: string) => readFileSync(path, 'utf8');
const ourHooks = (settingsPath: string) => (read(settingsPath).match(/estimetry hook claude-code/g) ?? []).length;

beforeEach(() => {
  cli = cliSandbox();
});

describe('estimetry init', () => {
  it('the hooks it writes run this installation without estimetry or node on PATH, as asdf or an IDE leave them', async () => {
    const repo = gitRepo('no-path');
    await init(repo);
    const settings = JSON.parse(read(join(repo, '.claude', 'settings.local.json'))) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    const command = settings.hooks['SessionStart']?.[0]?.hooks[0]?.command ?? '';
    const env = { HOME: cli.userHome, PATH: '/usr/bin:/bin' };
    const result = spawnSync('/bin/sh', ['-c', command], { cwd: repo, env, encoding: 'utf8', input: JSON.stringify({ session_id: 's1', cwd: repo, source: 'startup' }) });
    expect(result.stdout).toContain('"additionalContext":"estimetry: before you name an effort');
    // The data directory of init: the sandbox, not the default under HOME.
    expect(existsSync(join(cli.home, 'events'))).toBe(true);
  });

  it('sets up a clean project and changes nothing on a second run', async () => {
    const repo = gitRepo('my-app', { 'package.json': '{"dependencies":{"react":"18"}}', 'tsconfig.json': '{}', 'openspec/project.md': '' });
    const report = await init(repo);
    expect(report).toMatchObject({ project: 'my-app', flow: 'openspec', tools: ['claude-code'], stack: ['javascript', 'react', 'typescript'] });
    expect(ourHooks(join(repo, '.claude', 'settings.local.json'))).toBe(12);
    expect(existsSync(join(cli.claudeDir, 'skills', 'emt-estimate', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(repo, '.claude', 'skills'))).toBe(false);
    expect(read(join(repo, '.estimetry', 'config.yaml'))).toBe('schemaVersion: 1\nproject: my-app\nflow: openspec\n');
    expect(read(join(cli.home, 'projects.yaml'))).toMatch(/stack:\n\s+- javascript\n\s+- react\n\s+- typescript/);

    const second = await init(repo);
    expect(second.files.map((file) => file.status)).toEqual(second.files.map(() => 'unchanged'));
  });

  it('keeps the user’s own hooks and settings', async () => {
    const repo = gitRepo('api');
    mkdirSync(join(repo, '.claude'));
    writeFileSync(
      join(repo, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'npm run lint' }] }] } }, null, 2),
    );
    await init(repo);
    await init(repo);
    const settings = JSON.parse(read(join(repo, '.claude', 'settings.local.json'))) as { permissions: unknown; hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test)'] });
    const [theirs, ours] = settings.hooks['PostToolUse']?.map((group) => group.hooks[0]?.command) ?? [];
    expect(settings.hooks['PostToolUse']).toHaveLength(2);
    expect(theirs).toBe('npm run lint');
    expect(ours).toMatch(/ hook claude-code PostToolUse; else estimetry hook claude-code PostToolUse; fi$/);
  });

  it('a shared install goes into committed files and back out with --no-shared-hooks', async () => {
    const repo = gitRepo('team', { 'CLAUDE.md': '# Team rules\n' });
    await init(repo, '--shared-hooks');
    expect(ourHooks(join(repo, '.claude', 'settings.json'))).toBe(12);
    expect(existsSync(join(repo, '.claude', 'skills', 'emt-start', 'SKILL.md'))).toBe(true);
    expect(read(join(repo, 'CLAUDE.md'))).toMatch(/^# Team rules\n\n<!-- estimetry:start -->/);

    await init(repo); // the shared install is kept: it is what is installed
    expect(existsSync(join(repo, '.claude', 'settings.json'))).toBe(true);

    await init(repo, '--no-shared-hooks');
    expect(existsSync(join(repo, '.claude', 'settings.json'))).toBe(false);
    expect(ourHooks(join(repo, '.claude', 'settings.local.json'))).toBe(12);
    expect(existsSync(join(repo, '.claude', 'skills', 'emt-start'))).toBe(false);
    expect(existsSync(join(cli.claudeDir, 'skills', 'emt-start', 'SKILL.md'))).toBe(true);
    expect(read(join(repo, 'CLAUDE.md'))).toBe('# Team rules\n');
  });

  it('installs the git hook, keeps it on a later run without the flag and removes it on request', async () => {
    const repo = gitRepo('svc');
    const hook = join(repo, '.git', 'hooks', 'post-commit');
    await init(repo, '--track-commits');
    expect(read(hook)).toContain('estimetry hook git post-commit');
    await init(repo);
    expect(existsSync(hook)).toBe(true);
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
    await init(repo, '--no-track-commits');
    expect(existsSync(hook)).toBe(false);
  });

  it('accepts claude as a name of the tool and refuses an unknown one without touching anything', async () => {
    const repo = gitRepo('alias');
    expect((await init(repo, '--tools', 'claude', '--flow', 'none', '--share', 'none')).tools).toEqual(['claude-code']);

    const other = gitRepo('other');
    const refused = await cli.run(['init', '--no-interactive', '--tools', 'cursor'], other);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('expected one of: claude-code');
    expect(existsSync(join(other, '.claude'))).toBe(false);
    expect(read(join(cli.home, 'projects.yaml'))).not.toContain('id: other');
  });

  it('a broken settings file stops init before any change, the registry included', async () => {
    const repo = gitRepo('broken');
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'settings.local.json'), '{ "hooks": [');
    const result = await cli.run(['init', '--no-interactive'], repo);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('.claude/settings.local.json: not valid JSON');
    expect(existsSync(join(repo, '.estimetry'))).toBe(false);
    expect(existsSync(join(cli.claudeDir, 'skills'))).toBe(false);
    expect(existsSync(join(cli.home, 'projects.yaml'))).toBe(false);
  });

  it('joins a second clone to the project and keeps another repository with the same id apart', async () => {
    const origin = gitRepo('my-app');
    await init(origin);
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'estimetry');

    const clone = join(cli.repo('review'), 'my-app-review');
    git(origin, 'clone', '-q', origin, clone);
    expect((await init(clone)).project).toBe('my-app');
    expect(read(join(cli.home, 'projects.yaml')).match(/my-app-review/g)).toHaveLength(1);

    const stranger = gitRepo('stranger', { '.estimetry/config.yaml': 'project: my-app\n' });
    const report = await init(stranger);
    expect(report.project).toBe('my-app-2');
    expect(report.warnings.join('\n')).toContain('registered as my-app-2');
    expect(read(join(stranger, '.estimetry', 'config.yaml'))).toContain('project: my-app\n');
  });

  it('warns that local settings are not ignored by git and changes no excludes without consent', async () => {
    const repo = gitRepo('plain');
    const report = await init(repo);
    expect(report.warnings.join('\n')).toContain(".claude/settings.local.json is not ignored by git");
    expect(existsSync(join(cli.userHome, '.config', 'git', 'ignore'))).toBe(false);
  });
});

describe('estimetry hook', () => {
  it('always exits 0 without output, logging what it could not accept', async () => {
    const repo = gitRepo('hooks');
    const ok = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', 'Stop'], {
      cwd: repo,
      env: cli.env,
      input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'Stop' }),
      encoding: 'utf8',
    });
    expect({ code: ok.status, stdout: ok.stdout, stderr: ok.stderr }).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(existsSync(join(cli.home, 'errors.log'))).toBe(false);

    for (const args of [['hook', 'cursor', 'Stop'], ['hook'], ['hook', 'claude-code', 'Stop', 'extra', '--weird']]) {
      expect(await cli.run(args, repo, 'estimetry')).toEqual({ code: 0, stdout: '', stderr: '' });
    }
    const log = read(join(cli.home, 'errors.log'));
    expect(log).toContain('unknown hook source "cursor"');
    expect(log).toContain('needs a source and an event');
    expect(log).toContain('unexpected hook arguments');
  });

  it('returns right away when the caller closes stdin, as Claude Code does', () => {
    const repo = gitRepo('fast');
    const started = Date.now();
    const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', 'PreToolUse'], {
      cwd: repo,
      env: cli.env,
      input: JSON.stringify({ session_id: 's1', tool_name: 'Bash' }),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toBe('');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('is hidden from the help, unlike init', async () => {
    const help = await cli.run(['--help'], gitRepo('help'));
    expect(help.stdout).toMatch(/^\s+init\b/m);
    expect(help.stdout).not.toMatch(/^\s+hook\b/m);
  });
});
