import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCloseProposals } from '../../support/closing-fakes.js';
import type { ActivityDraft, CommitHookAdapter, HookKind, HookSource } from '../../../src/application/contracts/hook-adapter.js';
import { gitHooks } from '../../../src/integrations/tools/git/git-hooks.js';
import { CommitRecords, CommitTask } from '../../../src/application/hooks/commit-records.js';
import { RecentSessions } from '../../../src/application/hooks/recent-sessions.js';
import { BindSession } from '../../../src/application/task/bind-session.js';
import { Checkpoints } from '../../../src/application/hooks/checkpoints.js';
import { ActivityRecorder } from '../../../src/application/hooks/activity-recorder.js';
import { PendingProposal } from '../../../src/application/hooks/pending-proposal.js';
import { PromptContext } from '../../../src/application/hooks/prompt-context.js';
import { ReceiveHook } from '../../../src/application/hooks/receive-hook.js';
import { ReceiveSessionHook } from '../../../src/application/hooks/receive-session-hook.js';
import { SESSION_END_IMPORT_BUDGET_MS, SessionEndImport } from '../../../src/application/hooks/session-end-import.js';
import { SessionStartContext } from '../../../src/application/hooks/session-start-context.js';
import type { SessionImportRequest } from '../../../src/application/task/import-session-logs.js';
import { SessionTask } from '../../../src/application/hooks/session-task.js';
import { SessionId } from '../../../src/domain/measurement/session-id.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';
import { FakeAuthorProvider, FixedClock, FixedMeasurementSettings, RecordingErrorReporter, SequentialIdGenerator } from '../../support/fakes.js';
import {
  FakeGit,
  FakeHookAdapter,
  FakeProjectLocator,
  FakeProjectPlans,
  InMemoryCheckpointState,
  InMemorySessionBindings,
  RepositoryTaskStatusReader,
  plainImport,
} from '../../support/hook-fakes.js';
import { ListRegistry } from '../../support/in-memory-files.js';
import { InMemoryEventJournal, InMemoryTaskRepository } from '../../support/in-memory-repositories.js';
import { CheckpointSnapshot } from '../../../src/application/hooks/checkpoint-snapshot.js';
import { EventMetaSource } from '../../../src/application/shared/event-meta-source.js';
import { SessionWindow } from '../../../src/application/task/session-window.js';

const API = '/work/api';
const day = (hhmm: string) => `2026-10-27T${hhmm}:00.000Z`;

let tasks: InMemoryTaskRepository;
let journal: InMemoryEventJournal;
let bindings: InMemorySessionBindings;
let state: InMemoryCheckpointState;
let clock: FixedClock;
let settings: FixedMeasurementSettings;
let errors: RecordingErrorReporter;
let git: FakeGit;
let receive: ReceiveHook;
/** Another source of commits: the receiver takes it with no change of its own. */
const hgHooks: CommitHookAdapter = { kind: 'commit', id: 'hg', aliases: [], hookEvents: ['commit'], commitOf: () => ({}) };
let bind: BindSession;
let n = 0;

function startedTask(id: string, title: string, startedAt = day('09:00')): void {
  const meta = () => ({ id: `m-${++n}`, at: Timestamp.parse(day('09:59')), author: Author.of('dev@example.com') });
  const task = Task.create({ id: TaskId.parse(id), title, type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: ProjectId.parse('api') }, meta());
  task.start(ProjectId.parse('api'), meta(), Timestamp.parse(startedAt));
  tasks.save(task);
}

const tool = (toolUseId: string): ActivityDraft => ({ type: 'tool.used', data: { toolUseId } });

function call(event: string, kind: HookKind, events: readonly ActivityDraft[] = [], options: { session?: string; cwd?: string; transcript?: string } = {}) {
  return receive.execute({
    source: 'fake-tool',
    event,
    payload: JSON.stringify({ session: options.session ?? 's1', kind, events, ...(options.transcript === undefined ? {} : { transcript: options.transcript }) }),
    cwd: options.cwd ?? API,
  });
}

let checked: string[] = [];
let imports: SessionImportRequest[] = [];
let proposals: InMemoryCloseProposals;

const types = (task: string) => journal.readActivity(TaskId.parse(task)).map((e) => e.type);

beforeEach(() => {
  checked = [];
  imports = [];
  proposals = new InMemoryCloseProposals();
  tasks = new InMemoryTaskRepository();
  journal = new InMemoryEventJournal();
  bindings = new InMemorySessionBindings();
  state = new InMemoryCheckpointState();
  clock = new FixedClock(day('10:00'));
  settings = new FixedMeasurementSettings();
  errors = new RecordingErrorReporter();
  git = new FakeGit();
  const ids = new SequentialIdGenerator();
  const authors = new FakeAuthorProvider();
  const status = new RepositoryTaskStatusReader(tasks);
  const recent = new RecentSessions(state, settings);
  const checkpoints = new Checkpoints(
    state,
    journal,
    new CheckpointSnapshot(new FakeProjectPlans(), git, git),
    settings,
    errors,
    new EventMetaSource({ now: () => { throw new Error('the clock is not read here'); } }, ids, authors),
  );
  const proposal = new PendingProposal(proposals, recent, async () => ({ of: () => ({ done: 51, unfinished: ['release'] }) }));
  const sessions = new ReceiveSessionHook(
    new FakeProjectLocator(),
    new SessionTask(bindings, status, new SessionWindow(journal, new EventMetaSource(clock, ids, authors))),
    new ActivityRecorder(journal, bindings, checkpoints, { check: (task) => void checked.push(task.id.toString()) }, new EventMetaSource(clock, ids, authors)),
    new SessionStartContext(async () => ({ fact: () => ({ minutes: 210, likelyHours: 58.5, planDone: 51 }) }), checkpoints, proposal),
    new PromptContext(checkpoints, proposal),
    new SessionEndImport(bindings, status, async () => ({
      execute: (request: SessionImportRequest) => {
        imports.push(request);
        return [];
      },
    })),
  );
  const commits = new CommitRecords(new FakeProjectLocator(), git, new CommitTask(bindings, status, recent), journal, new EventMetaSource(clock, ids, authors));
  receive = new ReceiveHook(new ListRegistry<HookSource>([new FakeHookAdapter(), gitHooks, hgHooks]), clock, commits, sessions);
  bind = new BindSession(bindings, status, new SessionWindow(journal, new EventMetaSource(clock, ids, authors)));
});

describe('which task a session serves', () => {
  it('checks the archive for completions on every call of a bound session, sync or async', async () => {
    await call('ToolDone', 'tool-done', [tool('t0')], { session: 's0' });
    expect(checked).toEqual([]);
    startedTask('T-1', 'estimetry v1');
    await call('ToolDone', 'tool-done', [tool('t1')]);
    await call('Prompt', 'prompt', []);
    expect(checked).toEqual(['T-1', 'T-1']);
  });

  it('binds to the only task in progress, opening the window at the start of the task', async () => {
    startedTask('T-1', 'estimetry v1');
    await call('ToolDone', 'tool-done', [tool('t1')]);
    const events = journal.readActivity(TaskId.parse('T-1'));
    expect(events.map((e) => [e.type, e.ts])).toEqual([
      ['session.bound', day('09:00')],
      ['tool.used', day('10:00')],
    ]);
    expect(events[1]?.data).toMatchObject({ source: 'fake-tool', session: 's1', toolUseId: 't1' });
  });

  it('writes events of a session without a task to the project, and copies them when a backdated task starts', async () => {
    await call('ToolDone', 'tool-done', [tool('t1')]);
    expect(journal.readUnassigned(ProjectId.parse('api'))).toHaveLength(1);
    startedTask('T-1', 'Late start', day('09:30'));
    clock.set(day('10:05'));
    await call('Prompt', 'prompt', [{ type: 'turn.started', data: { origin: 'user' } }]);
    expect(types('T-1')).toEqual(['session.bound', 'tool.used', 'turn.started']);
    // Copying is idempotent: a second binding attempt does not duplicate.
    expect(journal.readActivity(TaskId.parse('T-1')).filter((e) => e.type === 'tool.used')).toHaveLength(1);
  });

  it('keeps "no task" for a minute on background calls, but looks again on a prompt', async () => {
    await call('ToolDone', 'tool-done');
    startedTask('T-1', 'Started meanwhile');
    clock.set(day('10:00').replace(':00.000Z', ':30.000Z'));
    await call('ToolDone', 'tool-done', [tool('t2')]);
    expect(types('T-1')).toEqual([]);
    await call('Prompt', 'prompt', [{ type: 'turn.started', data: { origin: 'user' } }]);
    expect(types('T-1')).toContain('turn.started');
  });

  it('with two tasks asks the agent to choose and gives the command with the session id', async () => {
    startedTask('T-1', 'Payments');
    startedTask('T-2', 'Webhooks');
    const out = await call('Start', 'session-start', [{ type: 'session.started', data: {} }]);
    expect(JSON.parse(out ?? '{}').text).toBe(
      'estimetry: before you name an effort or a deadline for a task, run /emt-estimate.\n' +
        'estimetry: several tasks are in progress in this project: T-1 "Payments", T-2 "Webhooks". ' +
        'Ask the user which one this session serves, then run: emt attach <task> --session s1',
    );
    expect(journal.readUnassigned(ProjectId.parse('api')).map((e) => e.type)).toEqual(['session.started']);
  });

  it('the first task of a session chosen with attach counts its work since the task started, as an automatic binding does', async () => {
    startedTask('T-1', 'Payments', day('09:00'));
    startedTask('T-2', 'Webhooks', day('09:30'));
    clock.set(day('09:20'));
    await call('ToolDone', 'tool-done', [tool('before-start')]);
    clock.set(day('09:40'));
    await call('ToolDone', 'tool-done', [tool('after-start')]);
    await call('ToolDone', 'tool-done', [tool('other-session')], { session: 's2' });
    expect(types('T-2')).toEqual([]);
    clock.set(day('10:20'));
    bind.bind(SessionId.parse('s1'), TaskId.parse('T-2'), { id: ProjectId.parse('api'), root: API }, clock.now());
    const events = journal.readActivity(TaskId.parse('T-2'));
    expect(events.map((e) => [e.type, e.ts, e.data.session])).toEqual([
      ['session.bound', day('09:30'), 's1'],
      ['tool.used', day('09:40'), 's1'],
    ]);
    expect(bindings.plain('s1')).toMatchObject({ task: 'T-2', since: day('09:30'), everBound: true });
    bind.bind(SessionId.parse('s1'), TaskId.parse('T-2'), { id: ProjectId.parse('api'), root: API }, clock.now());
    expect(journal.readActivity(TaskId.parse('T-2'))).toHaveLength(2);
    expect(journal.readActivity(TaskId.parse('T-1'))).toEqual([]);
  });

  it('a session attached from another directory takes its events from the journal of its own project', async () => {
    startedTask('T-1', 'Payments', day('09:00'));
    startedTask('T-2', 'Webhooks', day('09:30'));
    clock.set(day('09:40'));
    await call('ToolDone', 'tool-done', [tool('in-api')]);
    clock.set(day('10:20'));
    bind.bind(SessionId.parse('s1'), TaskId.parse('T-2'), { id: ProjectId.parse('web'), root: '/work/web' }, clock.now());
    expect(types('T-2')).toEqual(['session.bound', 'tool.used']);
  });

  it('a switch with attach closes the window in the old task and opens one in the new task', async () => {
    startedTask('T-1', 'Payments');
    await call('ToolDone', 'tool-done', [tool('t1')]);
    startedTask('T-2', 'Webhooks');
    clock.set(day('10:20'));
    bind.bind(SessionId.parse('s1'), TaskId.parse('T-2'), { id: ProjectId.parse('api'), root: API }, clock.now());
    await call('ToolDone', 'tool-done', [tool('t2')]);
    expect(types('T-1')).toEqual(['session.bound', 'tool.used', 'session.unbound']);
    expect(types('T-2')).toEqual(['session.bound', 'tool.used']);
    expect(journal.readActivity(TaskId.parse('T-2'))[0]?.ts).toBe(day('10:20'));
  });

  it('attach refuses a task that is not in progress and leaves the binding', async () => {
    startedTask('T-1', 'Payments');
    await call('ToolDone', 'tool-done');
    expect(() => bind.bind(SessionId.parse('s1'), TaskId.parse('T-9'), { id: ProjectId.parse('api'), root: API }, clock.now())).toThrow(/T-9 is not in progress/);
    expect(bindings.plain('s1')?.task).toBe('T-1');
  });

  it('a bound session keeps writing to its task after the agent changed directory', async () => {
    startedTask('T-1', 'Payments');
    await call('ToolDone', 'tool-done');
    await call('ToolDone', 'tool-done', [tool('t2')], { cwd: '/tmp/scratch' });
    expect(types('T-1').filter((t) => t === 'tool.used')).toHaveLength(1);
  });

  it('a session bound to a task no longer in progress is resolved again', async () => {
    startedTask('T-1', 'Payments');
    bindings.update(SessionId.parse('s1'), () => ({ session: SessionId.parse('s1'), project: ProjectId.parse('api'), root: API, task: TaskId.parse('T-9'), since: Timestamp.parse(day('08:00')), everBound: true }));
    await call('ToolDone', 'tool-done', [tool('t1')]);
    expect(bindings.plain('s1')?.task).toBe('T-1');
    // The session served a task before, so the new window starts now, not at the start of T-1.
    expect(journal.readActivity(TaskId.parse('T-1'))[0]).toMatchObject({ type: 'session.bound', ts: day('10:00') });
  });

  it('stays silent outside registered projects', async () => {
    startedTask('T-1', 'Payments');
    expect(await call('ToolDone', 'tool-done', [tool('t1')], { cwd: '/elsewhere' })).toBeUndefined();
    expect(types('T-1')).toEqual([]);
    expect(journal.unassigned.size).toBe(0);
  });
});

describe('checkpoints and context', () => {
  it('writes a checkpoint when the interval has passed, and reminds on the next prompt once', async () => {
    startedTask('T-1', 'Payments');
    await call('ToolDone', 'tool-done');
    clock.set(day('10:10'));
    await call('ToolDone', 'tool-done');
    clock.set(day('10:21'));
    await call('Stop', 'turn-end');
    const records = journal.readRecords(TaskId.parse('T-1'));
    expect(records.map((r) => r.ts)).toEqual([day('10:00'), day('10:21')]);
    expect(records[0]?.data).toMatchObject({ plan: [{ change: 'a', done: 1, total: 4 }], head: 'abc123', workingTree: { fileCount: 1, untracked: 0 } });

    const reminder = await call('Prompt', 'prompt');
    expect(JSON.parse(reminder ?? '{}').text).toBe('estimetry: if the work has gone beyond the plan, record it with /emt-extra.');
    expect(await call('Prompt', 'prompt')).toBeUndefined();
  });

  it('writes no checkpoint on synchronous calls and runs no git there', async () => {
    startedTask('T-1', 'Payments');
    await call('Prompt', 'prompt');
    await call('Start', 'session-start');
    expect(journal.readRecords(TaskId.parse('T-1'))).toEqual([]);
    expect(git.workingTreeCalls).toBe(0);
  });

  it('a snapshot part that fails stays empty, the checkpoint is still written', async () => {
    startedTask('T-1', 'Payments');
    git.headSha = undefined;
    await call('ToolDone', 'tool-done');
    const [record] = journal.readRecords(TaskId.parse('T-1'));
    expect(record?.data).not.toHaveProperty('head');
    expect(record?.data).not.toHaveProperty('workingTree');
  });

  it('reports a broken interval once per session and uses the default', async () => {
    startedTask('T-1', 'Payments');
    settings.checkpoint = { minutes: 20, problem: 'measurement.checkpointMinutes must be a whole number from 10 to 30' };
    await call('ToolDone', 'tool-done');
    clock.set(day('10:30'));
    await call('ToolDone', 'tool-done');
    expect(errors.reports).toHaveLength(1);
    expect(journal.readRecords(TaskId.parse('T-1'))).toHaveLength(2);
  });

  it('starts every session with the reminder of estimate mode; the limit shortens the list of tasks, never the command', async () => {
    for (let i = 1; i <= 30; i++) {
      startedTask(`T-${i}`, `A rather long title of task number ${i} to fill the context`);
    }
    const out = await call('Start', 'session-start', [{ type: 'session.started', data: {} }]);
    const text = JSON.parse(out ?? '{}').text as string;
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text.split('\n')[0]).toBe('estimetry: before you name an effort or a deadline for a task, run /emt-estimate.');
    expect(text.endsWith('then run: emt attach <task> --session s1')).toBe(true);
    expect(text).toMatch(/and \d+ more \(emt task list\)/);
  });

  it('starts a session with the task and its fact', async () => {
    startedTask('T-1', 'estimetry v1');
    const out = await call('Start', 'session-start', [{ type: 'session.started', data: {} }]);
    expect(JSON.parse(out ?? '{}').text).toBe(
      'estimetry: before you name an effort or a deadline for a task, run /emt-estimate.\n' +
        'estimetry: task T-1 "estimetry v1" — 3h 30m of 58h 30m (6%), plan 51% done. If the work has gone beyond the plan, record it with /emt-extra.',
    );
  });

  it('says that nothing is counted when no task is in progress', async () => {
    const out = await call('Start', 'session-start');
    expect(JSON.parse(out ?? '{}').text).toMatch(/no task is in progress .* \/emt-start/);
  });
});

describe('the receiver itself', () => {
  it('refuses unknown sources, events and stdin that is not JSON without repeating it', async () => {
    await expect(receive.execute({ source: 'cursor', event: 'Stop', payload: '{}', cwd: API })).rejects.toThrow(/unknown hook source "cursor"/);
    await expect(receive.execute({ source: 'fake-tool', event: 'Teleport', payload: '{}', cwd: API })).rejects.toThrow(InvalidValue);
    await expect(receive.execute({ source: undefined, event: undefined, payload: '', cwd: API })).rejects.toThrow(/needs a source/);
    const secret = receive.execute({ source: 'fake-tool', event: 'Stop', payload: 'password=hunter2', cwd: API });
    await expect(secret).rejects.toThrow(/stdin is not JSON/);
    await secret.catch((error: Error) => expect(error.message).not.toContain('hunter2'));
  });
});

describe('commits', () => {
  const commit = () => receive.execute({ source: 'git', event: 'post-commit', payload: '', cwd: API });

  it('an unknown event of git is refused as any source refuses one', async () => {
    startedTask('T-1', 'Payments');
    await expect(receive.execute({ source: 'git', event: 'pre-commit', payload: '', cwd: API })).rejects.toThrow('unknown git hook event "pre-commit"');
    expect(journal.readRecords(TaskId.parse('T-1'))).toEqual([]);
  });

  it('another source of commits records with its own id', async () => {
    startedTask('T-1', 'Payments');
    await receive.execute({ source: 'hg', event: 'commit', payload: '', cwd: API });
    expect(journal.readRecords(TaskId.parse('T-1'))[0]).toMatchObject({ type: 'commit.recorded', data: { source: 'hg', sha: 'c0ffee' } });
  });

  it('the sha the hook passes is the commit read', async () => {
    startedTask('T-1', 'Payments');
    await receive.execute({ source: 'git', event: 'post-commit', payload: 'c0ffee1\n', cwd: API });
    await commit();
    expect(git.commitsAsked).toEqual(['c0ffee1', undefined]);
  });

  it('goes to the only task in progress', async () => {
    startedTask('T-1', 'Payments');
    await commit();
    expect(journal.readRecords(TaskId.parse('T-1'))[0]).toMatchObject({
      type: 'commit.recorded',
      data: { sha: 'c0ffee', parents: ['abc123'], patchId: 'p1d', fileCount: 1, truncated: false },
    });
  });

  it('with two tasks goes to the task of the session active last, else to the project', async () => {
    startedTask('T-1', 'Payments');
    startedTask('T-2', 'Webhooks');
    await commit();
    expect(journal.readUnassigned(ProjectId.parse('api'))).toHaveLength(0); // records are kept apart from activity
    expect(journal.unassigned.get('api')?.map((e) => e.type)).toEqual(['commit.recorded']);

    bind.bind(SessionId.parse('s7'), TaskId.parse('T-2'), { id: ProjectId.parse('api'), root: API }, clock.now());
    await call('ToolDone', 'tool-done', [], { session: 's7' });
    clock.set(day('10:05'));
    await commit();
    expect(journal.readRecords(TaskId.parse('T-2')).map((r) => r.type)).toContain('commit.recorded');
  });
});

describe('after closing and proposals', () => {
  const commit = () => receive.execute({ source: 'git', event: 'post-commit', payload: '', cwd: API });
  const closedSession = (session: string) =>
    bindings.update(SessionId.parse(session), () => ({ session: SessionId.parse(session), project: ProjectId.parse('api'), root: API, everBound: true, closedTask: TaskId.parse('T-1') }));

  it('a session unbound by closing stays without a task until it starts again, and its commit goes to no task', async () => {
    startedTask('T-3', 'Other');
    closedSession('s1');
    await call('Prompt', 'prompt', [], { session: 's1' });
    expect(bindings.plain('s1')?.task).toBeUndefined();
    expect(journal.readActivity(TaskId.parse('T-3'))).toEqual([]);

    clock.set(day('10:01'));
    await commit();
    expect(journal.readRecords(TaskId.parse('T-3'))).toEqual([]);
    expect(journal.unassigned.get('api')?.map((e) => e.type)).toContain('commit.recorded');

    await call('Start', 'session-start', [], { session: 's1' });
    expect(bindings.plain('s1')?.task).toBe('T-3');
  });

  it('delivers a pending proposal once, before the reminder, to the session that noticed the completion', async () => {
    startedTask('T-1', 'estimetry v1');
    proposals.put(TaskId.parse('T-1'), { change: 'plan-progress', completedAt: Timestamp.parse(day('09:40')), session: SessionId.parse('s1') });
    const first = await call('Prompt', 'prompt', [], { session: 's1' });
    expect(first).toContain('change plan-progress of task T-1 was completed at 2026-10-27 09:40 UTC; the plan is 51% done, unfinished: release.');
    expect(first).toContain('(/emt-close)');
    expect(first).not.toContain('--yes');
    expect(await call('Prompt', 'prompt', [], { session: 's1' })).toBeUndefined();
  });

  it('with a reminder pending too, both come on the same prompt, the proposal first', async () => {
    startedTask('T-1', 'Payments');
    await call('ToolDone', 'tool-done');
    clock.set(day('10:21'));
    await call('Stop', 'turn-end'); // a checkpoint, so the reminder waits for the next prompt
    proposals.put(TaskId.parse('T-1'), { change: 'a', completedAt: Timestamp.parse(day('10:20')), session: SessionId.parse('s1') });
    const text = JSON.parse((await call('Prompt', 'prompt')) ?? '{}').text as string;
    expect(text.indexOf('change a of task T-1')).toBeLessThan(text.indexOf('/emt-extra'));
    expect(text.indexOf('change a of task T-1')).toBeGreaterThanOrEqual(0);
    expect(await call('Prompt', 'prompt')).toBeUndefined();
  });

  it('another session gets the proposal only after the first one has been idle past the threshold', async () => {
    startedTask('T-1', 'estimetry v1');
    await call('ToolDone', 'tool-done', [tool('t1')], { session: 's1' });
    proposals.put(TaskId.parse('T-1'), { change: 'a', completedAt: Timestamp.parse(day('09:40')), session: SessionId.parse('s1') });
    expect(await call('Prompt', 'prompt', [], { session: 's2' })).toBeUndefined();
    clock.set(day('11:00'));
    expect(await call('Prompt', 'prompt', [], { session: 's2' })).toContain('change a of task T-1');
  });
});


describe('the log of a session', () => {
  it('keeps the path of the log, and imports it into the tasks in progress of the session at its end, within the budget', async () => {
    startedTask('T-1', 'estimetry v1');
    await call('Start', 'session-start', [{ type: 'session.started', data: {} }], { transcript: '/logs/s1.jsonl' });
    expect(bindings.plain('s1')).toMatchObject({ task: 'T-1', tasks: ['T-1'], transcript: '/logs/s1.jsonl' });
    await call('ToolDone', 'tool-done', [tool('t1')]);
    expect(imports).toEqual([]);
    await call('End', 'session-end', [{ type: 'session.ended', data: {} }]);
    expect(imports.map(plainImport)).toEqual([
      { session: 's1', source: 'fake-tool', path: '/logs/s1.jsonl', tasks: [{ id: 'T-1', project: 'api' }], budgetMs: SESSION_END_IMPORT_BUDGET_MS },
    ]);
  });

  it('imports nothing into a task closed before its session ended', async () => {
    startedTask('T-1', 'estimetry v1');
    await call('Start', 'session-start', [{ type: 'session.started', data: {} }], { transcript: '/logs/s1.jsonl' });
    const task = tasks.listAll().find((t) => t.id.toString() === 'T-1');
    task?.close({ at: Timestamp.parse(day('10:30')), outcome: 'completed' }, { id: 'm-close', at: Timestamp.parse(day('10:30')), author: Author.of('dev@example.com') });
    if (task) {
      tasks.save(task);
    }
    await call('End', 'session-end', [{ type: 'session.ended', data: {} }]);
    expect(imports).toEqual([]);
  });

  it('imports nothing for a session without a task in progress', async () => {
    await call('End', 'session-end', [{ type: 'session.ended', data: {} }], { session: 's9' });
    expect(imports).toEqual([]);
  });
});
