import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cliSandbox, type CliSandbox } from '../support/cli.js';

let cli: CliSandbox;
let repo: string;

const emt = (...args: string[]) => cli.run(args, repo);
const today = () => new Date().toISOString().slice(0, 10);
const changes = () => join(repo, 'openspec', 'changes');

function hook(event: string, payload: Record<string, unknown> = {}, session = 's1'): string | undefined {
  const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', event], {
    cwd: repo,
    env: cli.env,
    input: JSON.stringify({ session_id: session, cwd: repo, hook_event_name: event, ...payload }),
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  return result.stdout.trim() === '' ? undefined : (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
}

function records(type: string): Record<string, unknown>[] {
  const file = join(cli.home, 'events', 'T-1.jsonl');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> })
        .filter((entry) => entry.type === type)
        .map((entry) => entry.data)
    : [];
}

function change(name: string, tasks: string): void {
  mkdirSync(join(changes(), name), { recursive: true });
  writeFileSync(join(changes(), name, 'tasks.md'), tasks);
}

const PLAN = `schemaVersion: 1
parts:
  - { id: auth, name: auth, group: auth, hours: { optimistic: 2, likely: 4, pessimistic: 6 } }
  - { id: billing, name: billing, group: billing, hours: { optimistic: 2, likely: 4, pessimistic: 6 } }
  - { id: search, name: search, group: search, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }
`;

beforeEach(async () => {
  cli = cliSandbox();
  repo = cli.repo('api');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: repo });
  mkdirSync(join(changes(), 'archive'), { recursive: true });
  change('auth', '- [x] a\n- [ ] manual check\n');
  change('billing', '- [x] a\n- [ ] b\n');
  expect((await emt('init', '--no-interactive', '--flow', 'openspec')).code).toBe(0);
  await emt('task', 'new', 'Payments');
  writeFileSync(join(repo, 'plan.yaml'), PLAN);
  expect((await emt('estimate', 'save', 'plan.yaml')).code).toBe(0);
  await emt('start', '--at', new Date(Date.now() - 60_000).toISOString());
});

describe('plan progress', () => {
  it('emt status counts the plan by changes and names the groups without a change', async () => {
    const text = await emt('status');
    // auth 4h at 50%, billing 4h at 50%, search 2h not started: 4 of 10 hours.
    expect(text.stdout).toMatch(/plan\s+40% done by changes \(10h of 10h in groups\)/);
    expect(text.stdout).toMatch(/not started\s+search/);
    const json = JSON.parse((await emt('status', '--json')).stdout) as Record<string, unknown>;
    expect(json).toMatchObject({ plan: { done: 40, mode: 'changes', groupedHours: 10, estimateHours: 10 }, planUnavailable: null, completedChanges: [] });
  });

  it('a change moved into the archive is completed on the next hook call, and moved back it is not', async () => {
    hook('SessionStart', { source: 'startup' });
    expect(records('plan.baseline')).toEqual([expect.objectContaining({ project: 'api', directories: [] })]);
    const archived = join(changes(), 'archive', `${today()}-auth`);
    renameSync(join(changes(), 'auth'), archived);
    hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 5 });
    hook('UserPromptSubmit', { prompt: 'next' });
    expect(records('change.completed')).toEqual([
      expect.objectContaining({ project: 'api', change: 'auth', directory: `${today()}-auth`, flow: 'openspec', approximate: false }),
    ]);
    const status = await emt('status');
    expect(status.stdout).toMatch(/plan\s+60% done by changes/);
    expect(status.stdout).toMatch(/changes\s+1 done, last auth \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

    renameSync(archived, join(changes(), 'auth'));
    const back = JSON.parse((await emt('status', '--json')).stdout) as { completedChanges: unknown[]; plan: { done: number } };
    expect(back).toMatchObject({ completedChanges: [], plan: { done: 40 } });
  });

  it('the session start line carries the plan, and parallel on records its share', async () => {
    expect(hook('SessionStart', { source: 'startup' })).toMatch(/^estimetry: task T-1 "Payments" — .*, plan 40% done\./m);
    const on = await emt('parallel', 'on', '--json');
    expect(JSON.parse(on.stdout)).toMatchObject({ enabled: true, planShare: 0.4 });
    const enabled = readFileSync(join(cli.home, 'events', 'T-1.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; data: { planShare?: number } })
      .find((entry) => entry.type === 'task.parallel-mode-enabled');
    expect(enabled?.data.planShare).toBe(0.4);
  });

  it('names a project of the task that is not on this machine next to the percent', async () => {
    const web = cli.repo('web');
    execFileSync('git', ['init', '-q'], { cwd: web });
    expect((await cli.run(['init', '--no-interactive', '--flow', 'none'], web)).code).toBe(0);
    expect((await cli.run(['attach', 'T-1'], web)).code).toBe(0);
    rmSync(web, { recursive: true, force: true });
    const text = await emt('status');
    expect(text.stdout).toMatch(/plan\s+40% done by changes/);
    expect(text.stdout).toMatch(/not tracked\s+web \(the project is not on this machine\)/);
  });

  it('an unknown flow in the config is named, not taken for none', async () => {
    writeFileSync(join(repo, '.estimetry', 'config.yaml'), 'schemaVersion: 1\nproject: api\nflow: opnspec\n');
    const text = await emt('status');
    expect(text.stdout).toMatch(/plan\s+not tracked: unknown flow "opnspec" in \.estimetry\/config\.yaml/);
    expect(JSON.parse((await emt('status', '--json')).stdout)).toMatchObject({
      plan: null,
      planUnavailable: 'unknown-flow',
      untrackedProjects: [{ project: 'api', reason: 'unknown-flow', flow: 'opnspec' }],
    });
  });

  it('a project with the flow none shows why the plan is not tracked', async () => {
    expect((await emt('init', '--no-interactive', '--flow', 'none')).code).toBe(0);
    const text = await emt('status');
    expect(text.stdout).toMatch(/plan\s+not tracked: the project's flow has no plan/);
    expect(JSON.parse((await emt('status', '--json')).stdout)).toMatchObject({ plan: null, planUnavailable: 'flow-none' });
  });
});
