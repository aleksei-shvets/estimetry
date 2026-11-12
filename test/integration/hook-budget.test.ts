import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Estimate } from '../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../src/domain/estimate/three-point-estimate.js';
import { ProjectId } from '../../src/domain/project/project-id.js';
import { Project } from '../../src/domain/project/project.js';
import { Author } from '../../src/domain/shared/author.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import { Task } from '../../src/domain/task/task.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../src/domain/task/task-type.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { FileProjectRepository } from '../../src/infrastructure/persistence/file-project-repository.js';
import { FileTaskRepository } from '../../src/infrastructure/persistence/file-task-repository.js';
import { YamlCheckpointState, YamlSessionStore } from '../../src/infrastructure/persistence/yaml-session-store.js';
import { FileCloseProposals } from '../../src/infrastructure/persistence/file-close-proposals.js';
import { SessionId } from '../../src/domain/measurement/session-id.js';
import { cliSandbox } from '../support/cli.js';
import { TaskId } from '../../src/domain/task/task-id.js';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

function timed(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }): number {
  const started = performance.now();
  const result = spawnSync(command, args, { ...options, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return performance.now() - started;
}

describe('hook budgets on a large store', () => {
  it('stays within the budgets with 100 tasks, a journal of 100 000 events and 50 archived changes', () => {
    const cli = cliSandbox();
    const repo = cli.repo('api');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const layout = new StorageLayout(cli.home);
    mkdirSync(cli.home, { recursive: true });
    writeFileSync(layout.configFile, 'schemaVersion: 1\nauthor:\n  id: dev@example.com\n');
    new FileProjectRepository(layout).addIfAbsent(
      Project.register({ id: ProjectId.parse('api'), name: 'api', path: repo }, Author.of('dev@example.com'), Timestamp.fromMillis(0)),
    );
    const tasks = new FileTaskRepository(layout);
    let n = 0;
    const meta = () => ({ id: `m-${++n}`, at: Timestamp.parse('2026-10-27T08:00:00.000Z'), author: Author.of('dev@example.com') });
    for (let i = 0; i < 100; i++) {
      const task = Task.create({ id: tasks.nextId(), title: `Task ${i}`, type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: ProjectId.parse('api') }, meta());
      if (i === 0) {
        task.start(ProjectId.parse('api'), meta());
      }
      tasks.save(task);
    }
    // 100 000 activity events of T-1 in 2 000 sessions of 50 events.
    const lines: string[] = [];
    const base = Date.parse('2026-10-27T08:00:00.000Z');
    for (let i = 0; i < 100_000; i++) {
      const type = i % 50 === 0 ? 'turn.started' : i % 50 === 49 ? 'turn.ended' : i % 2 === 0 ? 'tool.started' : 'tool.used';
      const data = type === 'turn.started' ? { origin: 'user' } : type.startsWith('tool') ? { toolUseId: `t${i >> 1}` } : {};
      lines.push(JSON.stringify({ schemaVersion: 1, id: `e${i}`, ts: new Date(base + i * 5_000).toISOString(), type, author: 'dev@example.com', task: 'T-1', project: 'api', data: { source: 'claude-code', session: `s${Math.floor(i / 50)}`, ...data } }));
    }
    appendFileSync(layout.taskJournal('T-1'), `${lines.join('\n')}\n`);
    // A bound session with a fresh checkpoint: the hot path of a hook during work.
    new YamlSessionStore(layout).update(SessionId.parse('live'), () => ({ session: SessionId.parse('live'), project: ProjectId.parse('api'), root: repo, task: TaskId.parse('T-1'), since: Timestamp.parse('2026-10-27T08:00:00.000Z'), everBound: true }));
    new YamlCheckpointState(layout).write(SessionId.parse('live'), { lastAt: new Date().toISOString() });

    // A project on OpenSpec with 50 archived changes: every bound call lists the archive.
    mkdirSync(join(repo, '.estimetry'), { recursive: true });
    writeFileSync(join(repo, '.estimetry', 'config.yaml'), 'schemaVersion: 1\nproject: api\nflow: openspec\n');
    for (let i = 0; i < 50; i++) {
      const dir = join(repo, 'openspec', 'changes', 'archive', `2026-10-${String(1 + (i % 28)).padStart(2, '0')}-change-${i}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'tasks.md'), '- [x] done\n');
    }
    const env = cli.env;
    const run = (event: string, extra: Record<string, unknown> = {}) =>
      timed(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', event], {
        cwd: repo,
        env,
        input: JSON.stringify({ session_id: 'live', cwd: repo, prompt_id: 'p', ...extra }),
      });
    const node = median(Array.from({ length: 10 }, () => timed(process.execPath, ['-e', '0'], { cwd: repo, env })));
    const background = median(Array.from({ length: 10 }, () => run('PostToolUse', { tool_name: 'Read', tool_use_id: 'x', duration_ms: 3 }))) - node;
    const prompt = median(Array.from({ length: 10 }, () => run('UserPromptSubmit', { prompt: 'go' }))) - node;
    const start = median(Array.from({ length: 5 }, () => run('SessionStart', { source: 'resume' }))) - node;
    // A pending proposal to close the task makes the prompt read the plan of the task.
    const proposals = new FileCloseProposals(layout);
    const proposing = median(
      Array.from({ length: 5 }, () => {
        proposals.put(TaskId.parse('T-1'), { change: 'change-1', completedAt: Timestamp.parse(new Date().toISOString()), session: SessionId.parse('live') });
        return run('UserPromptSubmit', { prompt: 'go' });
      }),
    ) - node;
    expect(existsSync(layout.closeProposal('T-1'))).toBe(false);
    // The end of a session of a task in progress whose log Claude Code never wrote: the import finds nothing.
    const sessions = new YamlSessionStore(layout);
    const end = median(
      Array.from({ length: 5 }, () => {
        sessions.update(SessionId.parse('ending'), () => ({ session: SessionId.parse('ending'), project: ProjectId.parse('api'), root: repo, task: TaskId.parse('T-1'), tasks: [TaskId.parse('T-1')], since: Timestamp.parse('2026-10-27T08:00:00.000Z'), everBound: true }));
        return run('SessionEnd', { session_id: 'ending', reason: 'exit' });
      }),
    ) - node;
    console.log(
      `hook budget, ms beyond node start: background ${background.toFixed(0)}, prompt ${prompt.toFixed(0)}, ` +
        `prompt with a proposal ${proposing.toFixed(0)}, session start ${start.toFixed(0)}, session end without a log ${end.toFixed(0)}`,
    );
    // Budgets are 150, 150, 150, 1000 and 150 ms; CI machines get twice as much.
    expect(background).toBeLessThan(300);
    expect(prompt).toBeLessThan(300);
    expect(proposing).toBeLessThan(300);
    expect(end).toBeLessThan(300);
    expect(start).toBeLessThan(2000);
  }, 180_000);

  it('stays within the budgets for a project with three worktrees, where every call looks at each copy', () => {
    const cli = cliSandbox();
    const repo = cli.repo('core');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
    git(repo, 'init', '-q');
    git(repo, '-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    const worktrees = [1, 2, 3].map((i) => join(cli.repo(`wt${i}`), `core-${i}`));
    worktrees.forEach((worktree) => git(repo, 'worktree', 'add', '-q', worktree));
    const copies = [repo, ...worktrees];
    // Each copy: 50 archived changes; the changes of the task are active in the last worktree.
    for (const copy of copies) {
      for (let i = 0; i < 50; i++) {
        const dir = join(copy, 'openspec', 'changes', 'archive', `2026-10-${String(1 + (i % 28)).padStart(2, '0')}-change-${i}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'tasks.md'), '- [x] done\n');
      }
    }
    for (const change of ['task-a', 'task-b']) {
      mkdirSync(join(copies[3] as string, 'openspec', 'changes', change), { recursive: true });
      writeFileSync(join(copies[3] as string, 'openspec', 'changes', change, 'tasks.md'), '- [x] one\n- [ ] two\n');
    }
    mkdirSync(join(repo, '.estimetry'), { recursive: true });
    writeFileSync(join(repo, '.estimetry', 'config.yaml'), 'schemaVersion: 1\nproject: core\nflow: openspec\n');
    const layout = new StorageLayout(cli.home);
    mkdirSync(cli.home, { recursive: true });
    writeFileSync(layout.configFile, 'schemaVersion: 1\nauthor:\n  id: dev@example.com\n');
    const projects = new FileProjectRepository(layout);
    const core = ProjectId.parse('core');
    projects.addIfAbsent(Project.register({ id: core, name: 'core', path: repo }, Author.of('dev@example.com'), Timestamp.fromMillis(0)));
    worktrees.forEach((worktree) => projects.update(core, (project) => project.withPath(worktree)));
    const tasks = new FileTaskRepository(layout);
    let n = 0;
    const meta = () => ({ id: `m-${++n}`, at: Timestamp.parse('2026-10-27T08:00:00.000Z'), author: Author.of('dev@example.com') });
    const task = Task.create({ id: tasks.nextId(), title: 'In a worktree', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: core }, meta());
    const parts = ['task-a', 'task-b'].map((group) => EstimatePart.of({ id: group, name: group, group, hours: ThreePointEstimate.of({ optimistic: 1, likely: 2, pessimistic: 3 }) }));
    task.saveEstimate(Estimate.of({ parts }), undefined, meta());
    task.start(core, meta());
    tasks.save(task);
    new YamlSessionStore(layout).update(SessionId.parse('live'), () => ({ session: SessionId.parse('live'), project: core, root: repo, task: task.id, since: Timestamp.parse('2026-10-27T08:00:00.000Z'), everBound: true }));
    new YamlCheckpointState(layout).write(SessionId.parse('live'), { lastAt: new Date().toISOString() });
    const run = (event: string, extra: Record<string, unknown> = {}) =>
      timed(process.execPath, [join(cli.bin, 'estimetry'), 'hook', 'claude-code', event], {
        cwd: repo,
        env: cli.env,
        input: JSON.stringify({ session_id: 'live', cwd: repo, prompt_id: 'p', ...extra }),
      });
    const node = median(Array.from({ length: 10 }, () => timed(process.execPath, ['-e', '0'], { cwd: repo, env: cli.env })));
    const background = median(Array.from({ length: 10 }, () => run('PostToolUse', { tool_name: 'Read', tool_use_id: 'x', duration_ms: 3 }))) - node;
    const prompt = median(Array.from({ length: 10 }, () => run('UserPromptSubmit', { prompt: 'go' }))) - node;
    // A checkpoint is due: the working copy of the task is looked for again, then git snapshots it.
    const checkpoints = new YamlCheckpointState(layout);
    const checkpoint = median(
      Array.from({ length: 5 }, () => {
        checkpoints.write(SessionId.parse('live'), { lastAt: '2026-10-27T08:00:00.000Z' });
        return run('PostToolUse', { tool_name: 'Read', tool_use_id: 'x', duration_ms: 3 });
      }),
    ) - node;
    // Each due call wrote one: the time above is the time of a checkpoint.
    const written = readFileSync(layout.taskJournal(task.id.toString()), 'utf8').split('\n').filter((line) => line.includes('"checkpoint.recorded"'));
    expect(written).toHaveLength(5);
    console.log(
      `hook budget with four copies, ms beyond node start: background ${background.toFixed(0)}, prompt ${prompt.toFixed(0)}, ` +
        `background with a checkpoint ${checkpoint.toFixed(0)}`,
    );
    // The same budgets as for one copy: 150 ms, CI machines get twice as much.
    expect(background).toBeLessThan(300);
    expect(prompt).toBeLessThan(300);
    expect(checkpoint).toBeLessThan(300);
  }, 180_000);
});
