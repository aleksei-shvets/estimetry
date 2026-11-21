import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cliSandbox, type CliSandbox } from '../support/cli.js';
import { log, SECRET, text, writeLog } from '../support/claude-log.js';
import { rollout, SECRET as CODEX_SECRET, writeRollout } from '../support/codex-log.js';

let cli: CliSandbox;
let repo: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cli.env }).trim();
const emt = (...args: string[]) => cli.run(args, repo);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function hook(event: string, payload: Record<string, unknown> = {}) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', event], {
    cwd: repo,
    env: cli.env,
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: event, ...payload }),
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return Date.now() - started;
}

const journal = (task = 'T-1') =>
  readFileSync(join(cli.home, 'events', `${task}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });

/** Activity of the session the hooks missed the end of a turn in, written as an older estimetry would have. */
function pastActivity(): void {
  let n = 0;
  const event = (type: string, ts: string, data: Record<string, unknown> = {}) =>
    JSON.stringify({ schemaVersion: 1, id: `past-${++n}`, ts, type, author: 'dev@example.com', task: 'T-1', project: 'api', data: { source: 'claude-code', session: 's1', ...data } });
  appendFileSync(
    join(cli.home, 'events', 'T-1.jsonl'),
    [event('turn.started', ago(90), { origin: 'user' }), event('tool.used', ago(80)), event('turn.started', ago(40), { origin: 'user' }), event('turn.ended', ago(35))].join('\n') + '\n',
  );
}

/** The log of the same session: the first turn ended 25 minutes in. */
function sessionLog(): string {
  return writeLog(cli.claudeDir, [
    log.prompt(ago(90)),
    log.assistant(ago(80), { usage: { output: 1_000 } }),
    log.assistant(ago(65), { stop: 'end_turn', usage: { output: 2_000, cacheRead: 50_000 } }),
    log.prompt(ago(40)),
    log.assistant(ago(35), { stop: 'end_turn', usage: { output: 500 } }),
    log.cost(1, 1.5),
  ]).path;
}

type Status = { factLow: number; factHigh: number; uncertainty: number; usage: { costUSD: number; withLogs: number; sessions: number; tokens: Record<string, { output: number }> } | null };
const status = async () => JSON.parse((await emt('status', '--json')).stdout) as Status;

beforeEach(async () => {
  cli = cliSandbox();
  repo = cli.repo('api');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'dev@example.com');
  git(repo, 'config', 'user.name', 'Dev');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  expect((await emt('init', '--no-interactive')).code).toBe(0);
  await emt('task', 'new', 'Payments');
  expect((await emt('start', '--at', ago(120))).code).toBe(0);
  pastActivity();
});

describe('the log of a session', () => {
  it('the session end imports it: the turn without its end closes where the log ends it, tokens and cost appear', async () => {
    const path = sessionLog();
    hook('SessionStart', { source: 'resume', transcript_path: path });
    const before = await status();
    expect(before.usage).toBeNull();
    hook('SessionEnd', { reason: 'other' });
    expect(journal().filter((e) => e.type === 'log.session')).toHaveLength(1);
    const after = await status();
    expect(after.uncertainty).toBeLessThan(before.uncertainty);
    expect(after.usage).toMatchObject({ costUSD: 1.5, withLogs: 1, sessions: 1, tokens: { 'claude-opus-5-5': { output: 3_500 } } });
    expect((await emt('status')).stdout).toMatch(/cost\s+\$1\.50, from the logs of 1 of 1 sessions/);
    expect(readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8')).not.toContain(SECRET);
    expect(existsSync(join(cli.home, 'errors.log')) ? readFileSync(join(cli.home, 'errors.log'), 'utf8') : '').not.toContain(SECRET);
  });

  it('finds the log by the path the hook reported, even outside the tool’s config folder', async () => {
    const elsewhere = writeLog(join(cli.userHome, 'other'), [log.prompt(ago(90)), log.assistant(ago(65), { stop: 'end_turn' })]).path;
    hook('SessionStart', { source: 'resume', transcript_path: elsewhere });
    hook('SessionEnd', { reason: 'other' });
    expect(journal().filter((e) => e.type === 'log.session')).toHaveLength(1);
  });

  it('the closing imports a session whose end came before this version, and rebuild without the logs gives the same card', async () => {
    sessionLog();
    expect((await emt('close', '--yes')).code).toBe(0);
    const types = journal().map((e) => e.type);
    expect(types.indexOf('log.session')).toBeLessThan(types.indexOf('task.closed'));
    const card = readFileSync(join(cli.home, 'cards', 'T-1.yaml'), 'utf8');
    expect(parse(card)).toMatchObject({ schemaVersion: 3, usage: { costUSD: 1.5, withLogs: 1 } });
    rmSync(join(cli.claudeDir, 'projects'), { recursive: true, force: true });
    expect((await emt('rebuild', 'T-1')).code).toBe(0);
    expect(readFileSync(join(cli.home, 'cards', 'T-1.yaml'), 'utf8')).toBe(card);
  });

  it('a broken log leaves a code in errors.log, never a line or a path of it', async () => {
    const path = writeLog(cli.claudeDir, [log.service('mode'), log.broken()]).path;
    hook('SessionStart', { source: 'resume', transcript_path: path });
    hook('SessionEnd', { reason: 'other' });
    expect(journal().filter((e) => e.type === 'log.session')).toHaveLength(0);
    const errors = readFileSync(join(cli.home, 'errors.log'), 'utf8');
    expect(errors).toContain('log-format-unrecognized');
    expect(errors).not.toContain(SECRET);
    expect(errors).not.toContain(cli.claudeDir);
  });

  it('the session end parses a 60 MB log within its budget', async () => {
    const path = sessionLog();
    const filler = text(Array.from({ length: 2_000 }, (_, i) => log.assistant(ago(60 - (i % 50) / 10), { id: `big-${i}` })));
    const block = filler.repeat(Math.ceil((60 * 1024 * 1024) / filler.length / 2));
    appendFileSync(path, block);
    appendFileSync(path, block);
    hook('SessionStart', { source: 'resume', transcript_path: path });
    const took = hook('SessionEnd', { reason: 'other' });
    expect(journal().filter((e) => e.type === 'log.session').length).toBeGreaterThan(0);
    expect(took).toBeLessThan(5_000);
  }, 60_000);
});

describe('the log of a Codex session', () => {
  const CODEX = '01a162ca-f1f0-7da1-9125-c703441d95a4';

  function codexHook(event: string, payload: Record<string, unknown> = {}) {
    const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'codex', event], {
      cwd: repo,
      env: cli.env,
      input: JSON.stringify({ session_id: CODEX, cwd: repo, model: 'gpt-x', hook_event_name: event, ...payload }),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  }

  it('the session end imports the rollout: tokens without a cost, and the cost says by how many sessions it counts', async () => {
    const path = writeRollout(cli.codexDir, CODEX, [
      rollout.meta(CODEX, ago(30)),
      rollout.started(ago(30), 't1'),
      rollout.turnContext(ago(30), 't1', 'gpt-x'),
      rollout.message(ago(25)),
      rollout.usage(ago(25), 'resp-1', { input: 10_000, cached: 9_000, output: 700 }),
      rollout.complete(ago(20), 't1'),
    ]);
    codexHook('SessionStart', { source: 'startup', transcript_path: path });
    codexHook('UserPromptSubmit', { turn_id: 't1', transcript_path: path });
    codexHook('Stop', { turn_id: 't1', transcript_path: path });
    codexHook('SessionEnd', { reason: 'other', transcript_path: path });
    const records = journal().filter((e) => e.type === 'log.session');
    expect(records).toHaveLength(1);
    expect(records[0]?.data).toMatchObject({ source: 'codex-log', session: CODEX, cost: [], costReported: false });
    const after = await status();
    expect(after.usage).toMatchObject({ costUSD: null, withLogs: 1, sessions: 2, tokens: { 'gpt-x': { output: 700 } } });
    expect((await emt('status')).stdout).toMatch(/cost\s+not reported, from the logs of 1 of 2 sessions, cost from 0 of 2 sessions/);
    expect(readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8')).not.toContain(CODEX_SECRET);
  });

  it('the closing imports a Codex session found without a path', async () => {
    writeRollout(cli.codexDir, CODEX, [rollout.meta(CODEX, ago(30)), rollout.started(ago(30), 't1'), rollout.complete(ago(20), 't1')], ago(30).slice(0, 10).split('-'));
    codexHook('UserPromptSubmit', { turn_id: 't1', transcript_path: null });
    expect((await emt('close', '--yes')).code).toBe(0);
    expect(journal().filter((e) => e.type === 'log.session').map((e) => e.data['source'])).toEqual(['codex-log']);
  });
});
