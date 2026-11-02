import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cliSandbox, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;
let repo: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cli.env }).trim();
const emt = (...args: string[]) => cli.run(args, repo);

/** A hook call the way Claude Code makes it: stdin closed after the JSON payload. */
function hook(event: string, payload: Record<string, unknown> = {}, session = 's1') {
  const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', event], {
    cwd: repo,
    env: cli.env,
    input: JSON.stringify({ session_id: session, cwd: repo, prompt_id: 'p-1', hook_event_name: event, ...payload }),
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout.trim() === '' ? undefined : (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
}

const journalLines = (name: string) => {
  const file = join(cli.home, 'events', name);
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { type: string; data: Record<string, unknown> }) : [];
};
const RECORDS = new Set(['checkpoint.recorded', 'commit.recorded', 'plan.started']);
const activity = (task: string) => journalLines(`${task}.jsonl`).filter((e) => !e.type.startsWith('task.') && !RECORDS.has(e.type));

beforeEach(async () => {
  cli = cliSandbox();
  repo = cli.repo('api');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'dev@example.com');
  git(repo, 'config', 'user.name', 'Dev');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  expect((await emt('init', '--no-interactive')).code).toBe(0);
});

describe('hooks write the journal of the session’s task', () => {
  it('a turn with a tool lands in the only task in progress, with context at the start and no prompt text', async () => {
    await emt('task', 'new', 'Payments');
    await emt('start');
    expect(hook('SessionStart', { source: 'startup' })).toMatch(/^estimetry: task T-1 "Payments"/);
    expect(hook('UserPromptSubmit', { prompt: 'deploy with password hunter2' })).toBeUndefined();
    hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: { command: 'echo hunter2' } });
    hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 12, tool_response: { stdout: 'hunter2' } });
    hook('Stop');
    expect(activity('T-1').map((e) => e.type)).toEqual(['session.bound', 'session.started', 'turn.started', 'tool.started', 'tool.used', 'turn.ended']);
    expect(readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8')).not.toContain('hunter2');
    expect(journalLines('T-1.jsonl').some((e) => e.type === 'checkpoint.recorded')).toBe(true);
    const status = JSON.parse((await emt('status', '--json')).stdout) as { agentTime: number };
    expect(status.agentTime).toBeGreaterThanOrEqual(0);
  });

  it('with two tasks the agent is asked to choose, and attach --session moves the session', async () => {
    await emt('task', 'new', 'Payments');
    await emt('start', 'T-1');
    await emt('task', 'new', 'Webhooks');
    await emt('start', 'T-2');
    const context = hook('SessionStart', { source: 'startup' });
    expect(context).toContain('emt attach <task> --session s1');
    expect(journalLines('unassigned/api.jsonl').map((e) => e.type)).toEqual(['session.started']);
    expect((await emt('attach', 'T-2', '--session', 's1')).code).toBe(0);
    hook('UserPromptSubmit', { prompt: 'go' });
    expect(activity('T-2').map((e) => e.type)).toEqual(['session.bound', 'turn.started']);
    expect(activity('T-1')).toEqual([]);
    const refused = await emt('attach', 'T-9', '--session', 's1');
    expect(refused.code).toBe(1);
  });

  it('work done without a task counts after a backdated start', async () => {
    hook('UserPromptSubmit', { prompt: 'start' });
    hook('PostToolUse', { tool_name: 'Read', tool_use_id: 'tu-1', duration_ms: 3 });
    expect(journalLines('unassigned/api.jsonl')).toHaveLength(2);
    await emt('task', 'new', 'Late');
    await emt('start', '--at', new Date(Date.now() - 3_600_000).toISOString());
    // Within a minute of "no task" a background hook still writes without a task…
    hook('Stop');
    expect(activity('T-1')).toEqual([]);
    // …and the next prompt binds the session and copies everything since the start.
    hook('UserPromptSubmit', { prompt: 'next' }, 's1');
    expect(activity('T-1').map((e) => e.type)).toEqual(['session.bound', 'turn.started', 'tool.used', 'turn.ended', 'turn.started']);
  });

  it('a commit is recorded in the task by the background git hook', async () => {
    await emt('task', 'new', 'Payments');
    await emt('start');
    await emt('init', '--no-interactive', '--track-commits');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'work');
    const deadline = Date.now() + 10_000;
    while (!journalLines('T-1.jsonl').some((e) => e.type === 'commit.recorded') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(journalLines('T-1.jsonl').find((e) => e.type === 'commit.recorded')?.data).toMatchObject({ sha: git(repo, 'rev-parse', 'HEAD') });
  });

  it('two commits in a row are both recorded, each by its own sha', async () => {
    await emt('task', 'new', 'Payments');
    await emt('start');
    await emt('init', '--no-interactive', '--track-commits');
    writeFileSync(join(repo, 'a.ts'), 'a\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'code');
    const first = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'archive');
    const second = git(repo, 'rev-parse', 'HEAD');
    const deadline = Date.now() + 10_000;
    const recorded = () => journalLines('T-1.jsonl').filter((e) => e.type === 'commit.recorded').map((e) => e.data['sha']);
    while (recorded().length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(recorded().sort()).toEqual([first, second].sort());
  });

  it('init installs the background hooks asynchronous and keeps three synchronous', () => {
    const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.local.json'), 'utf8')) as {
      hooks: Record<string, { hooks: { async?: boolean }[] }[]>;
    };
    const sync = Object.entries(settings.hooks).filter(([, groups]) => !groups[0]?.hooks[0]?.async).map(([event]) => event).sort();
    expect(sync).toEqual(['SessionEnd', 'SessionStart', 'UserPromptSubmit']);
  });

  it('stays silent in a directory that is not a project and logs a broken payload without its content', () => {
    const elsewhere = cli.repo('notes');
    const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', 'Stop'], {
      cwd: elsewhere,
      env: { ...cli.env, CLAUDE_PROJECT_DIR: elsewhere },
      input: JSON.stringify({ session_id: 's9', cwd: elsewhere }),
      encoding: 'utf8',
    });
    expect({ code: result.status, out: result.stdout + result.stderr }).toEqual({ code: 0, out: '' });
    expect(existsSync(join(cli.home, 'errors.log'))).toBe(false);
    spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', 'Stop'], { cwd: repo, env: cli.env, input: 'token=hunter2', encoding: 'utf8' });
    const log = readFileSync(join(cli.home, 'errors.log'), 'utf8');
    expect(log).toContain('stdin is not JSON');
    expect(log).not.toContain('hunter2');
  });
});
