import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cliSandbox, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;
let repo: string;

const emt = (...args: string[]) => cli.run(args, repo);
const changes = () => join(repo, 'openspec', 'changes');
const today = () => new Date().toISOString().slice(0, 10);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function hook(event: string, payload: Record<string, unknown> = {}): string | undefined {
  const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', event], {
    cwd: repo,
    env: cli.env,
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: event, ...payload }),
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  return result.stdout.trim() === '' ? undefined : (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
}

function journal(): { type: string; data: Record<string, unknown> }[] {
  return readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
}

function change(name: string, tasks: string): void {
  mkdirSync(join(changes(), name), { recursive: true });
  writeFileSync(join(changes(), name, 'tasks.md'), tasks);
}

const plan = (likely: number) => `schemaVersion: 1
type: feature
parts:
  - { id: auth, name: auth, group: auth, hours: { optimistic: 1, likely: ${likely}, pessimistic: 9 } }
  - { id: billing, name: billing, group: billing, hours: { optimistic: 1, likely: ${likely}, pessimistic: 9 } }
`;

beforeEach(async () => {
  cli = cliSandbox();
  repo = cli.repo('api');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  mkdirSync(join(changes(), 'archive'), { recursive: true });
  change('auth', '- [x] a\n');
  change('billing', '- [ ] b\n');
  expect((await emt('init', '--no-interactive', '--flow', 'openspec')).code).toBe(0);
  await emt('task', 'new', 'Payments');
  writeFileSync(join(repo, 'plan.yaml'), plan(2));
  writeFileSync(join(repo, 'plan2.yaml'), plan(3));
  await emt('estimate', 'save', 'plan.yaml');
  expect((await emt('start', '--at', ago(120))).code).toBe(0);
});

describe('emt estimate revise', () => {
  it('a rollback the same day: the archived change leaves the plan, the status shows the lost window', async () => {
    hook('SessionStart', { source: 'startup' });
    renameSync(join(changes(), 'auth'), join(changes(), 'archive', `${today()}-auth`));
    hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 5 });
    expect(journal().some((e) => e.type === 'change.completed' && e.data['change'] === 'auth')).toBe(true);
    expect(JSON.parse((await emt('status', '--json')).stdout)).toMatchObject({ plan: { done: 50 } });

    const revised = await emt('estimate', 'revise', 'plan2.yaml', '--reason', 'design was wrong', '--category', 'missed-analysis', '--spent', 'exclude', '--lost-from', ago(60));
    expect(revised.code).toBe(0);
    expect(revised.stdout).toMatch(/Revised the estimate of T-1 .* is lost and not counted; archived changes of that time leave the plan/);
    const status = JSON.parse((await emt('status', '--json')).stdout) as Record<string, unknown>;
    expect(status).toMatchObject({ plan: { done: 0, archivedBeforeRevision: ['auth'] }, completedChanges: [], revisions: [{ spent: 'exclude', missingSnapshot: false }] });
    expect((await emt('status')).stdout).toMatch(/archived before revision\s+auth/);
  });

  it('include keeps the counted fact, and refusals name what is missing', async () => {
    const noSpent = await emt('estimate', 'revise', 'plan2.yaml', '--reason', 'x', '--category', 'rework');
    expect(noSpent.code).toBe(1);
    expect(noSpent.stderr).toMatch(/--spent/);
    expect((await emt('parallel', 'on')).code).toBe(0);
    const parallel = await emt('estimate', 'revise', 'plan2.yaml', '--reason', 'x', '--category', 'rework', '--spent', 'include');
    expect(parallel.stderr).toMatch(/parallel off/);
    await emt('parallel', 'off');
    const saved = await emt('estimate', 'save', 'plan2.yaml');
    expect(saved.stderr).toMatch(/emt estimate revise/);
    const include = await emt('estimate', 'revise', 'plan2.yaml', '--reason', 'plan grew', '--category', 'rework', '--spent', 'include', '--json');
    expect(JSON.parse(include.stdout)).toMatchObject({ spent: 'include', lostFrom: null });
    expect(JSON.parse((await emt('status', '--json')).stdout)).toMatchObject({ lost: 0, estimate: { likely: 6 } });
  });

  it('lists extra work that may describe the same loss and records the confirmed one', async () => {
    const extra = await emt('extra', 'rolled back the design', '--category', 'missed-analysis', '--time', '1h', '--json');
    expect(extra.code).toBe(0);
    const events = readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; type: string });
    const extraId = events.find((e) => e.type === 'task.extra-recorded')?.id as string;
    const listed = await emt('estimate', 'revise', 'plan2.yaml', '--reason', 'design was wrong', '--category', 'missed-analysis', '--spent', 'exclude', '--covers', extraId);
    expect(listed.code).toBe(0);
    expect(listed.stderr).toContain(`covered by this revision: extra missed-analysis 1h "rolled back the design" [${extraId}]`);
    expect(JSON.parse((await emt('status', '--json')).stdout)).toMatchObject({ revisions: [{ covers: [extraId] }] });
  });

  it('a journal written by a newer estimetry is named, and other tasks still list', async () => {
    await emt('task', 'new', 'Other');
    appendFileSync(join(cli.home, 'events', 'T-1.jsonl'), `${JSON.stringify({ schemaVersion: 1, id: 'x', ts: new Date().toISOString(), type: 'task.something-new', author: 'a', task: 'T-1', project: 'api', data: {} })}\n`);
    const status = await emt('status', 'T-1');
    expect(status.code).toBe(1);
    expect(status.stderr).toMatch(/newer version of estimetry/);
    const list = JSON.parse((await emt('task', 'list', '--json')).stdout) as { id: string }[];
    // Lists read snapshots only; the journal of T-1 is opened when the task itself is read.
    expect(list.map((t) => t.id)).toContain('T-2');
    expect(existsSync(join(cli.home, 'tasks', 'T-2.yaml'))).toBe(true);
  });
});
