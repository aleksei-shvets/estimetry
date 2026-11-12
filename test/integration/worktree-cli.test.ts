import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cliSandbox, type CliSandbox } from '../support/cli.js';

/*
 * Two agents, each in a git worktree of its task, with their sessions open in
 * the main working copy and no committed .estimetry/config.yaml.
 */

let cli: CliSandbox;
let main: string;
let worktrees: { a: string; b: string };

const emt = (cwd: string, ...args: string[]) => cli.run(args, cwd);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });

function hook(session: string, event: string, payload: Record<string, unknown> = {}): void {
  const result = spawnSync(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', event], {
    cwd: main,
    env: cli.env,
    input: JSON.stringify({ session_id: session, cwd: main, hook_event_name: event, ...payload }),
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
}

function events(task: string): { type: string; ts: string; data: Record<string, unknown> }[] {
  return readFileSync(join(cli.home, 'events', `${task}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; ts: string; data: Record<string, unknown> });
}

beforeEach(async () => {
  cli = cliSandbox();
  main = cli.repo('core');
  git(main, 'init', '-q');
  git(main, '-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
  expect((await emt(main, 'init', '--no-interactive', '--flow', 'none')).code).toBe(0);
  worktrees = { a: join(cli.repo('wt'), 'core-a'), b: join(cli.repo('wt2'), 'core-b') };
  git(main, 'worktree', 'add', '-q', worktrees.a);
  git(main, 'worktree', 'add', '-q', worktrees.b);
});

describe('tasks in git worktrees, sessions in the main working copy', () => {
  it('a task started in a worktree belongs to the project of the main copy', async () => {
    expect((await emt(worktrees.a, 'task', 'new', 'Feature A')).code).toBe(0);
    expect((await emt(worktrees.a, 'start', '--at', ago(120))).code).toBe(0);
    const registry = parse(readFileSync(join(cli.home, 'projects.yaml'), 'utf8')) as { projects: { id: string; paths: string[] }[] };
    expect(registry.projects.map((p) => p.id)).toEqual(['core']);
    expect(registry.projects[0]?.paths).toEqual([main, worktrees.a]);
    expect(JSON.parse((await emt(main, 'task', 'show', 'T-1', '--json')).stdout)).toMatchObject({ projects: ['core'] });
  });

  it('a session of the main copy works unbound while two tasks run, and attach counts it from the start of its task', async () => {
    await emt(worktrees.a, 'task', 'new', 'Feature A');
    await emt(worktrees.a, 'start', '--at', ago(120));
    await emt(worktrees.b, 'task', 'new', 'Feature B');
    await emt(worktrees.b, 'start', 'T-2', '--at', ago(110));
    hook('s1', 'SessionStart', { source: 'startup' });
    hook('s1', 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' });
    hook('s1', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 5 });
    hook('s2', 'SessionStart', { source: 'startup' });
    expect(() => events('T-1')).not.toThrow();
    expect(events('T-1').filter((e) => e.data['session'] === 's1')).toEqual([]);

    expect((await emt(main, 'attach', 'T-1', '--session', 's1')).code).toBe(0);
    const t1 = events('T-1').filter((e) => e.data['session'] === 's1');
    expect(t1.map((e) => e.type)).toEqual(['session.bound', 'session.started', 'turn.started', 'tool.used']);
    const started = JSON.parse((await emt(main, 'task', 'show', 'T-1', '--json')).stdout) as { startedAt: string };
    expect(t1[0]?.ts).toBe(started.startedAt);
    expect(events('T-2').filter((e) => e.data['session'] === 's1')).toEqual([]);
  });

  it('the plan, the completion of its change and the code volume of a task are read in its worktree, asked from the main copy', async () => {
    git(main, 'config', 'user.email', 'dev@example.com');
    git(main, 'config', 'user.name', 'Dev');
    expect((await emt(main, 'init', '--no-interactive', '--flow', 'openspec')).code).toBe(0);
    const changeDir = join(worktrees.a, 'openspec', 'changes', 'feature-a');
    mkdirSync(join(worktrees.a, 'openspec', 'changes', 'archive'), { recursive: true });
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] one\n- [ ] two\n');
    writeFileSync(join(worktrees.a, 'plan.yaml'), 'schemaVersion: 1\ntype: feature\nparts:\n  - { name: a, group: feature-a, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }\n');
    await emt(worktrees.a, 'task', 'new', 'Feature A');
    expect((await emt(worktrees.a, 'estimate', 'save', 'plan.yaml')).code).toBe(0);
    expect((await emt(worktrees.a, 'start', '--at', ago(60))).code).toBe(0);

    expect(JSON.parse((await emt(main, 'status', 'T-1', '--json')).stdout)).toMatchObject({ plan: { done: 50 } });

    hook('s1', 'SessionStart', { source: 'startup' });
    writeFileSync(join(changeDir, 'tasks.md'), '- [x] one\n- [x] two\n');
    renameSync(changeDir, join(worktrees.a, 'openspec', 'changes', 'archive', `${new Date().toISOString().slice(0, 10)}-feature-a`));
    hook('s1', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 5 });
    const records = events('T-1');
    expect(records.some((e) => e.type === 'change.completed' && e.data['change'] === 'feature-a')).toBe(true);

    writeFileSync(join(worktrees.a, 'feature.ts'), 'export const a = 1;\nexport const b = 2;\n');
    git(worktrees.a, 'add', 'feature.ts');
    git(worktrees.a, 'commit', '-q', '-m', 'feature');
    expect((await emt(main, 'close', '--yes')).code).toBe(0);
    const measured = events('T-1').find((e) => e.type === 'code.measured') as { data: { projects: { source: string; files: { path: string }[] }[] } } | undefined;
    expect(measured?.data.projects[0]?.source).toBe('snapshots');
    expect(measured?.data.projects[0]?.files.map((f) => f.path)).toContain('feature.ts');
  });

  it('a change proposed on main before the worktree was made is read where it moves on', async () => {
    git(main, 'config', 'user.email', 'dev@example.com');
    git(main, 'config', 'user.name', 'Dev');
    expect((await emt(main, 'init', '--no-interactive', '--flow', 'openspec')).code).toBe(0);
    const proposed = join(main, 'openspec', 'changes', 'feature-c');
    mkdirSync(join(main, 'openspec', 'changes', 'archive'), { recursive: true });
    mkdirSync(proposed, { recursive: true });
    writeFileSync(join(proposed, 'tasks.md'), '- [ ] one\n- [ ] two\n');
    writeFileSync(join(main, 'openspec', 'changes', 'archive', '.keep'), '');
    git(main, 'add', 'openspec');
    git(main, 'commit', '-q', '-m', 'propose feature-c');
    const worktree = join(cli.repo('wt3'), 'core-c');
    git(main, 'worktree', 'add', '-q', worktree);
    writeFileSync(join(worktree, 'plan.yaml'), 'schemaVersion: 1\ntype: feature\nparts:\n  - { name: c, group: feature-c, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }\n');
    await emt(worktree, 'task', 'new', 'Feature C');
    await emt(worktree, 'estimate', 'save', 'plan.yaml');
    expect((await emt(worktree, 'start', '--at', ago(60))).code).toBe(0);
    expect(JSON.parse((await emt(main, 'status', 'T-1', '--json')).stdout)).toMatchObject({ plan: { done: 0 } });

    const inWorktree = join(worktree, 'openspec', 'changes', 'feature-c');
    writeFileSync(join(inWorktree, 'tasks.md'), '- [x] one\n- [ ] two\n');
    expect(JSON.parse((await emt(main, 'status', 'T-1', '--json')).stdout)).toMatchObject({ plan: { done: 50 } });

    hook('s1', 'SessionStart', { source: 'startup' });
    writeFileSync(join(inWorktree, 'tasks.md'), '- [x] one\n- [x] two\n');
    renameSync(inWorktree, join(worktree, 'openspec', 'changes', 'archive', `${new Date().toISOString().slice(0, 10)}-feature-c`));
    hook('s1', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 5 });
    expect(events('T-1').some((e) => e.type === 'change.completed' && e.data['change'] === 'feature-c')).toBe(true);
    expect(JSON.parse((await emt(main, 'status', 'T-1', '--json')).stdout)).toMatchObject({ plan: { done: 100 } });
  });
});

