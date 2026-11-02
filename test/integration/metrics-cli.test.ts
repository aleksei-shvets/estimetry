import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cliSandbox, ROOT, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;
let repo: string;

const FIXTURES = join(ROOT, 'test', 'fixtures', 'journals');

function gitRepo(name: string): string {
  const dir = cli.repo(name);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: dir });
  return dir;
}

const emt = (...args: string[]) => cli.run(args, repo);

function journal(task = 'T-1'): Record<string, unknown>[] {
  return readFileSync(join(cli.home, 'events', `${task}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function plan(content: string, name = 'plan.yaml'): string {
  writeFileSync(join(repo, name), content);
  return name;
}

const VALID_PLAN = `schemaVersion: 1
type: integration
parts:
  - { id: impl, name: implementation, hours: { optimistic: 4, likely: 8, pessimistic: 12 } }
  - { id: tests, name: auto tests, kind: auto-tests, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }
`;

/** A started task whose journal gets the activity of a fixture. */
async function startedWithFixture(fixture: string): Promise<void> {
  await emt('task', 'new', 'Fixture');
  await emt('start', '--at', '2026-10-20T09:00:00Z');
  appendFileSync(join(cli.home, 'events', 'T-1.jsonl'), readFileSync(join(FIXTURES, fixture), 'utf8'));
}

beforeEach(() => {
  cli = cliSandbox();
  repo = gitRepo('api');
});

describe('emt status on synthetic journals', () => {
  it('reproduces the example of design §4', async () => {
    await startedWithFixture('design-example.jsonl');
    const json = await emt('status', '--json');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      fact: 100,
      agentTime: 60,
      userTime: 40,
      agentWork: 180,
      uncertainty: 10,
      manualTime: 0,
      estimate: null,
      estimateShare: null,
    });
    const text = await emt('status');
    expect(text.stdout).toMatch(/fact\s+1h 40m \(no estimate\)/);
    expect(text.stdout).toMatch(/agent work\s+3h/);
    expect(text.stdout).toMatch(/uncertainty\s+± 10m \(10%\), above the 5% target/);
  });

  it('flags a fact that depends on silences near the threshold', async () => {
    await startedWithFixture('uncertain.jsonl');
    const view = JSON.parse((await emt('status', '--json')).stdout) as { uncertaintyExceedsTarget: boolean; fact: number };
    expect(view).toMatchObject({ fact: 100, uncertaintyExceedsTarget: true });
    expect((await emt('status')).stdout).toContain('above the 5% target');
  });

  it('uses the idle threshold from config.yaml', async () => {
    await startedWithFixture('uncertain.jsonl');
    writeFileSync(join(cli.home, 'config.yaml'), `${readFileSync(join(cli.home, 'config.yaml'), 'utf8')}measurement:\n  idleMinutes: 60\n`);
    expect(JSON.parse((await emt('status', '--json')).stdout)).toMatchObject({ fact: 140 });
  });

  it('refuses to guess between several tasks in progress', async () => {
    await emt('task', 'new', 'A');
    await emt('start', 'T-1');
    await emt('task', 'new', 'B');
    await emt('start', 'T-2');
    const result = await emt('status');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('T-1, T-2');
    expect((await emt('status', 'T-2')).code).toBe(0);
  });
});

describe('emt estimate save', () => {
  it('saves the estimate as the plan, takes its type and warns about missing manual testing', async () => {
    await emt('task', 'new', 'Webhook', '--type', 'feature');
    const result = await emt('estimate', 'save', plan(VALID_PLAN));
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Estimate saved for T-1: 5 \/ 10 \/ 15 h, 2 parts\nTime is not measured yet: start the task when work begins with `emt start T-1`/);
    expect((await emt('status', 'T-1')).stdout).toMatch(/not started: the time of sessions is not counted until `emt start T-1`/);
    expect(result.stderr).toBe('warning: the estimate has no manual-testing part\n');
    const task = JSON.parse((await emt('task', 'show', 'T-1', '--json')).stdout) as Record<string, unknown>;
    expect(task).toMatchObject({ status: 'estimated', estimated: true, type: 'integration' });
    expect(readFileSync(join(cli.home, 'tasks', 'T-1.yaml'), 'utf8')).toContain('likely: 8');

    const started = await emt('start');
    expect(started.stderr).toBe('');
    expect((await emt('status')).stdout).not.toContain('not started');
  });

  it('reports every problem in the file at once with paths', async () => {
    await emt('task', 'new', 'Webhook');
    const result = await emt(
      'estimate',
      'save',
      plan(`schemaVersion: 1
parts:
  - { name: a, hours: { optimistic: 2, likely: 1, pessimistic: 3 } }
  - { name: b, huors: { optimistic: 1, likely: 1, pessimistic: 1 } }
`),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('parts[0].hours: expected optimistic ≤ likely ≤ pessimistic');
    expect(result.stderr).toContain('parts[1].huors: unknown field');
    expect(journal()).toHaveLength(1);
  });

  it('allows re-estimating before the start only', async () => {
    await emt('task', 'new', 'Webhook');
    await emt('estimate', 'save', plan(VALID_PLAN));
    await emt('estimate', 'save', 'plan.yaml');
    expect(journal().filter((event) => event['type'] === 'task.estimated')).toHaveLength(2);
    await emt('start');
    const after = await emt('estimate', 'save', 'plan.yaml', '--task', 'T-1');
    expect(after.code).toBe(1);
    expect(after.stderr).toContain('T-1 is in-progress');
  });
});

describe('work records', () => {
  beforeEach(async () => {
    await emt('task', 'new', 'Webhook');
    await emt('estimate', 'save', plan(VALID_PLAN));
  });

  it('manual time needs a started task and a duration with a unit', async () => {
    const early = await emt('manual', '40m', 'x');
    expect(early.code).toBe(1);
    await emt('start', '--at', '2026-10-27T08:00:00Z');
    expect((await emt('manual', '90', 'x')).stderr).toContain('expected e.g. 40m, 1h30m or 1.5h');
    expect((await emt('manual', '1h30m', 'manual testing'))).toMatchObject({ code: 0, stdout: 'Recorded 1h 30m of user time for T-1: manual testing\n' });
    const agent = await emt('manual', '3h', 'change 1 before hooks', '--agent', '--at', '2026-10-27T12:00:00Z');
    expect(agent.code).toBe(0);
    const view = JSON.parse((await emt('status', '--json')).stdout) as Record<string, number>;
    expect(view).toMatchObject({ userTime: 90, agentTime: 180, fact: 270, manualTime: 270, manualShare: 1 });
  });

  it('a record without --at on measured time is added on top with a warning', async () => {
    await emt('start', '--at', '2026-10-27T08:00:00Z');
    const now = Date.now();
    const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const line = (ts: string, type: string, data: Record<string, unknown>) =>
      `${JSON.stringify({ schemaVersion: 1, id: `x-${ts}-${type}`, ts, type, author: 'dev@example.com', task: 'T-1', project: 'api', data: { source: 'test', session: 's1', ...data } })}\n`;
    appendFileSync(
      join(cli.home, 'events', 'T-1.jsonl'),
      line(iso(25), 'turn.started', { origin: 'user' }) + line(iso(20), 'turn.ended', {}),
    );
    const result = await emt('manual', '40m', 'call yesterday');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('--at');
    expect((await emt('manual', '10m', 'x', '--at', iso(1))).stderr).toBe('');
  });

  it('extra work is recorded as absorbed; an unknown category lists the allowed ones', async () => {
    await emt('start');
    expect(await emt('extra', 'Node 21 incompatibility', '--category', 'environment', '--time', '30m')).toMatchObject({
      code: 0,
      stdout: 'Recorded extra work for T-1 (environment, absorbed, 30m): Node 21 incompatibility\n',
    });
    expect(journal().at(-1)).toMatchObject({ type: 'task.extra-recorded', data: { category: 'environment', accounting: 'absorbed', timeMs: 1_800_000 } });
    const unknown = await emt('extra', 'x', '--category', 'oops');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('new-requirement, missed-analysis, rework, environment');
  });

  it('parallel mode records the budget share, refuses to switch twice and checks parts', async () => {
    await emt('start', '--at', '2026-10-27T08:00:00Z');
    await emt('manual', '6h', 'agents', '--agent', '--at', '2026-10-27T14:00:00Z');
    expect((await emt('parallel', 'on', '--parts', 'nope')).stderr).toContain('expected one of: impl, tests');
    expect((await emt('parallel', 'on', '--reason', 'deadline', '--agents', '3', '--parts', 'impl')).stdout).toBe(
      'Parallel mode on for T-1 (60% of the budget spent)\n',
    );
    expect(journal().at(-1)).toMatchObject({ type: 'task.parallel-mode-enabled', data: { budgetShare: 0.6, agents: 3, reason: 'deadline' } });
    expect((await emt('parallel', 'on')).code).toBe(1);
    expect((await emt('parallel', 'off')).code).toBe(0);
    expect((await emt('parallel', 'off')).code).toBe(1);
    expect((await emt('status')).stdout).toMatch(/parallel\s+3 agents, sequential 6h/);
  });
});

describe('emt start --at', () => {
  it('backdates the start, even before the task was created, but not into the future', async () => {
    await emt('task', 'new', 'Webhook');
    const future = await emt('start', '--at', new Date(Date.now() + 3_600_000).toISOString());
    expect(future.code).toBe(1);
    expect((await emt('start', '--at', '2026-10-26T09:00:00Z')).code).toBe(0);
    expect(JSON.parse((await emt('task', 'show', 'T-1', '--json')).stdout)).toMatchObject({ startedAt: '2026-10-26T09:00:00.000Z' });
    expect(journal().filter((event) => String(event['type']).startsWith('task.')).at(-1)).toMatchObject({
      type: 'task.started',
      data: { at: '2026-10-26T09:00:00.000Z' },
    });
  });

  it('shows moments in local time, in the form --at accepts, and keeps UTC in --json', async () => {
    await emt('task', 'new', 'Webhook');
    await emt('start', '--at', '2026-10-26 09:00');
    expect((await emt('manual', '30m', 'call', '--at', '2026-10-26 10:00')).stdout).toContain('ending 2026-10-26 10:00: call');
    expect((await emt('status')).stdout).toContain('in-progress since 2026-10-26 09:00\n');
    expect((await emt('task', 'show', 'T-1')).stdout).toMatch(/started\s+2026-10-26 09:00/);
    const startedAt = (JSON.parse((await emt('status', '--json')).stdout) as { task: { startedAt: string } }).task.startedAt;
    expect(startedAt).toBe(new Date(2026, 9, 26, 9, 0).toISOString());
  });
});
