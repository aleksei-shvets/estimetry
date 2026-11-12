import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cliSandbox, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cli.env }).trim();
const version = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;

function gitRepo(name: string): string {
  const dir = cli.repo(name);
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.email=dev@example.com', '-c', 'user.name=Dev', 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

/** As an older estimetry left them: hooks without one event, and an older version of the install. */
function age(roots: readonly string[]): void {
  for (const root of roots) {
    const path = join(root, '.claude', 'settings.local.json');
    const settings = JSON.parse(readFileSync(path, 'utf8')) as { hooks: Record<string, unknown> };
    delete settings.hooks['Stop'];
    writeFileSync(path, JSON.stringify(settings, null, 2));
  }
  writeFileSync(join(cli.home, 'installs.yaml'), `installs:\n${roots.map((root) => `  ${JSON.stringify(root)}: 0.0.1\n`).join('')}`);
}

const hasStop = (root: string) => 'Stop' in (JSON.parse(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8')) as { hooks: object }).hooks;
const installs = () => (parse(readFileSync(join(cli.home, 'installs.yaml'), 'utf8')) as { installs: Record<string, string> }).installs;

function sessionStart(root: string): string {
  const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', 'SessionStart'], {
    cwd: root,
    env: cli.env,
    input: JSON.stringify({ session_id: 's1', cwd: root, source: 'startup' }),
    encoding: 'utf8',
  });
  return result.stdout;
}

let api: string;
let web: string;
let worktree: string;

beforeEach(async () => {
  cli = cliSandbox();
  api = gitRepo('api');
  web = gitRepo('web');
  worktree = join(cli.repo('wt'), 'api-x');
  git(api, 'worktree', 'add', '-q', worktree);
  for (const root of [api, worktree, web]) {
    expect((await cli.run(['init', '--no-interactive', '--flow', 'none'], root)).code).toBe(0);
  }
  age([api, worktree, web]);
});

describe('emt upgrade', () => {
  it('without a terminal and --yes shows the plan, exits with 2 and changes nothing', async () => {
    const result = await cli.run(['upgrade'], cli.repo('elsewhere'));
    expect(result.code).toBe(2);
    expect(result.stdout).toContain(`estimetry ${version} will be set up again in 3 working copies`);
    expect(result.stdout).toContain('update  .claude/settings.local.json');
    expect(result.stdout).toContain('To update one project only, run `emt init` inside it instead.');
    expect(result.stderr).toMatch(/needs the user's confirmation: ask the user, then repeat the command with --yes/);
    expect([api, worktree, web].map(hasStop)).toEqual([false, false, false]);
    expect(Object.values(installs())).toEqual(['0.0.1', '0.0.1', '0.0.1']);
  });

  it('the session start asks the agent to suggest it, and stops asking after it ran with --yes', async () => {
    expect(sessionStart(api)).toContain(`estimetry ${version} is installed, but this project was set up by 0.0.1`);
    expect(sessionStart(api)).toContain('do not run it yourself');
    const result = await cli.run(['upgrade', '--yes', '--json'], cli.repo('elsewhere'));
    expect(result, result.stderr).toMatchObject({ code: 0 });
    const report = JSON.parse(result.stdout) as { upgraded: { root: string }[]; skipped: unknown[] };
    expect(report.upgraded).toHaveLength(3);
    expect([api, worktree, web].map(hasStop)).toEqual([true, true, true]);
    expect(Object.values(installs())).toEqual([version, version, version]);
    expect(sessionStart(api)).not.toContain('emt upgrade');
    const again = await cli.run(['init', '--no-interactive', '--json'], worktree);
    expect((JSON.parse(again.stdout) as { files: { status: string }[] }).files.every((file) => file.status === 'unchanged')).toBe(true);
  });

  it('prints the plan as JSON without --yes', async () => {
    const result = await cli.run(['upgrade', '--json'], api);
    expect(result.code).toBe(2);
    const plan = JSON.parse(result.stdout) as { version: string; copies: { root: string; installedBy: string }[] };
    expect(plan.version).toBe(version);
    expect(plan.copies.map((copy) => copy.installedBy)).toEqual(['0.0.1', '0.0.1', '0.0.1']);
  });
});
