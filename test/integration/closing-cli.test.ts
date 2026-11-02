import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cliSandbox, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;
let repo: string;

const emt = (...args: string[]) => cli.run(args, repo);
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: cli.env }).trim();
const changes = () => join(repo, 'openspec', 'changes');
const today = () => new Date().toISOString().slice(0, 10);

function hook(source: 'claude-code' | 'git', event: string, payload: Record<string, unknown> = {}, session = 's1'): string | undefined {
  const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', source, event], {
    cwd: repo,
    env: cli.env,
    input: source === 'git' ? '' : JSON.stringify({ session_id: session, cwd: repo, hook_event_name: event, ...payload }),
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  return result.stdout.trim() === '' ? undefined : (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
}

function lines(file: string): { type: string; data: Record<string, unknown> }[] {
  const path = join(cli.home, 'events', file);
  return existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { type: string; data: Record<string, unknown> })
    : [];
}

function change(name: string, tasks: string): void {
  mkdirSync(join(changes(), name), { recursive: true });
  writeFileSync(join(changes(), name, 'tasks.md'), tasks);
}

const PLAN = `schemaVersion: 1
type: feature
parts:
  - { id: auth, name: auth, group: auth, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }
  - { id: billing, name: billing, group: billing, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }
`;

beforeEach(async () => {
  cli = cliSandbox();
  repo = cli.repo('api');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Dev');
  mkdirSync(join(changes(), 'archive'), { recursive: true });
  change('auth', '- [ ] a\n- [ ] b\n');
  change('billing', '- [ ] c\n');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  expect((await emt('init', '--no-interactive', '--flow', 'openspec')).code).toBe(0);
  await emt('task', 'new', 'Payments');
  writeFileSync(join(repo, 'plan.yaml'), PLAN);
  expect((await emt('estimate', 'save', 'plan.yaml')).code).toBe(0);
  expect((await emt('start', '--at', new Date(Date.now() - 120_000).toISOString())).code).toBe(0);
});

describe('closing a task', () => {
  it('needs --yes without a terminal, then writes the measurements, the card and the calibration', async () => {
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'pay.ts'), 'a\nb\nc\n');
    git('add', '.');
    git('commit', '-qm', 'work');
    hook('git', 'post-commit');
    writeFileSync(join(repo, 'src', 'draft.ts'), 'one\ntwo\n');

    const refused = await emt('close');
    expect(refused.code).toBe(2);
    expect(refused.stderr).toMatch(/confirmation.*--yes/);
    expect(lines('T-1.jsonl').some((e) => e.type === 'task.closed')).toBe(false);

    const closed = await emt('close', '--yes');
    expect(closed.code).toBe(0);
    expect(closed.stdout).toMatch(/Closed T-1 "Payments"/);
    expect(closed.stdout).toContain('emt retro');
    const types = lines('T-1.jsonl').map((e) => e.type);
    expect(types.indexOf('code.measured')).toBeLessThan(types.indexOf('task.closed'));
    expect(types.indexOf('plan.closing')).toBeLessThan(types.indexOf('task.closed'));
    const card = parse(readFileSync(join(cli.home, 'cards', 'T-1.yaml'), 'utf8')) as { outcome: string; code: { lines: { production: { added: number } } }; retro: string };
    expect(card).toMatchObject({ outcome: 'completed', retro: 'pending', code: { lines: { production: { added: 5 } } } });
    const calibration = JSON.parse(readFileSync(join(cli.home, 'calibration.json'), 'utf8')) as { authors: Record<string, unknown> };
    expect(Object.keys(calibration.authors)).toEqual(['dev@example.com']);
    expect((await emt('extra', 'late', '--category', 'rework', '--task', 'T-1')).stderr).toMatch(/emt reopen T-1/);
  });

  it('records the retro, reopens the task and accepts records again', async () => {
    await emt('close', '--yes');
    const retro = await emt('retro', '--reason', 'auth: token refresh was missing', '--lesson', 'check auth flows first');
    expect(retro.code).toBe(0);
    const shown = await emt('task', 'show', 'T-1');
    expect(shown.stdout).toMatch(/reason\s+\[auth\] token refresh was missing/);
    expect((await emt('reopen', 'T-1')).code).toBe(0);
    expect(existsSync(join(cli.home, 'cards', 'T-1.yaml'))).toBe(false);
    expect((await emt('extra', 'late fix', '--category', 'rework')).code).toBe(0);
  });

  it('renegotiates: the original closes as it is and the rest becomes a new task', async () => {
    const result = await emt('renegotiate', 'Payments v2', '--description', 'refunds added', '--yes', '--json');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ closed: { outcome: 'renegotiated' }, spawned: { id: 'T-2', spawnedFrom: 'T-1' } });
    const list = JSON.parse((await emt('task', 'list', '--closed', '--json')).stdout) as { id: string; status: string }[];
    expect(list.map((t) => [t.id, t.status])).toEqual([['T-1', 'closed'], ['T-2', 'new']]);
  });

  it('proposes closing on the next prompt after a change moves into the archive, once', () => {
    hook('claude-code', 'SessionStart', { source: 'startup' });
    renameSync(join(changes(), 'auth'), join(changes(), 'archive', `${today()}-auth`));
    hook('claude-code', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 5 });
    const context = hook('claude-code', 'UserPromptSubmit', { prompt: 'next' });
    expect(context).toMatch(/change auth of task T-1 was completed .*unfinished: billing.*\/emt-close/);
    expect(context).not.toContain('--yes');
    expect(hook('claude-code', 'UserPromptSubmit', { prompt: 'again' })).toBeUndefined();
  });

  it('a session and its commit after closing go to no task', async () => {
    hook('claude-code', 'SessionStart', { source: 'startup' });
    await emt('close', '--yes');
    await emt('task', 'new', 'Next');
    await emt('start', 'T-2');
    hook('claude-code', 'UserPromptSubmit', { prompt: 'retro talk' });
    writeFileSync(join(repo, 'late.ts'), 'x\n');
    git('add', '.');
    git('commit', '-qm', 'after closing');
    hook('git', 'post-commit');
    expect(lines('T-2.jsonl').filter((e) => e.type === 'commit.recorded' || e.type === 'turn.started')).toEqual([]);
    expect(lines('unassigned/api.jsonl').map((e) => e.type)).toEqual(expect.arrayContaining(['turn.started', 'commit.recorded']));
  });

  it('the card comes from the journal: cleaning the archive and rebuilding leaves it as it was', async () => {
    renameSync(join(changes(), 'auth'), join(changes(), 'archive', `${today()}-auth`));
    await emt('close', '--yes');
    const before = readFileSync(join(cli.home, 'cards', 'T-1.yaml'), 'utf8');
    rmSync(join(changes(), 'archive'), { recursive: true });
    rmSync(join(changes(), 'billing'), { recursive: true });
    expect((await emt('rebuild')).code).toBe(0);
    expect(readFileSync(join(cli.home, 'cards', 'T-1.yaml'), 'utf8')).toBe(before);
  });

  it('rebuild brings back lost cards and snapshots, and new tasks still get fresh numbers', async () => {
    await emt('close', '--yes');
    rmSync(join(cli.home, 'cards'), { recursive: true });
    rmSync(join(cli.home, 'tasks'), { recursive: true });
    const rebuilt = await emt('rebuild');
    expect(rebuilt.code).toBe(0);
    expect(rebuilt.stdout).toMatch(/Rebuilt 1 task, 1 card/);
    expect(existsSync(join(cli.home, 'cards', 'T-1.yaml'))).toBe(true);
    expect(JSON.parse((await emt('task', 'new', 'X', '--json')).stdout)).toMatchObject({ id: 'T-2' });
  });
});
