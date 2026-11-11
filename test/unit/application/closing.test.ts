import { beforeEach, describe, expect, it } from 'vitest';
import { createEstimetry, type Estimetry } from '../../../src/application/estimetry.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { SessionId } from '../../../src/domain/measurement/session-id.js';
import type { CommitRecorded } from '../../../src/domain/progress/progress-records.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { TaskClosed, TaskNotClosed } from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { activity } from '../../support/activity.js';
import { closingPorts, fakeClosing, type FakeSessionLogs } from '../../support/closing-fakes.js';
import type { SessionLogRead } from '../../../src/application/contracts/session-logs.js';
import {
  FakeAuthorProvider,
  FakeWorkspaceLocator,
  FixedClock,
  FixedMeasurementSettings,
  InMemoryEstimateReader,
  InMemoryTaskTypeCatalog,
  SequentialIdGenerator,
} from '../../support/fakes.js';
import { FakeProjectPlans, InMemorySessionBindings, RepositoryTaskStatusReader } from '../../support/hook-fakes.js';
import { fakeInstallDependencies, InMemoryProjectConfigFile, InMemoryProjectFiles } from '../../support/in-memory-files.js';
import { InMemoryEventJournal, InMemoryProjectRepository, InMemoryTaskRepository } from '../../support/in-memory-repositories.js';

let tasks: InMemoryTaskRepository;
let journal: InMemoryEventJournal;
let estimates: InMemoryEstimateReader;
let clock: FixedClock;
let plans: FakeProjectPlans;
let bindings: InMemorySessionBindings;
let closing: ReturnType<typeof fakeClosing>;
let app: Estimetry;

const T = (id: string) => TaskId.parse(id);
const time = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
const ROOT = '/work/api';

function plan(parts: { id: string; group?: string; likely: number }[]): Estimate {
  return Estimate.of({
    parts: parts.map((p) =>
      EstimatePart.of({
        id: p.id,
        name: p.id,
        ...(p.group === undefined ? {} : { group: p.group }),
        hours: ThreePointEstimate.of({ optimistic: p.likely, likely: p.likely, pessimistic: p.likely }),
      }),
    ),
  });
}

/** T-1 with an estimate by groups `a` (4 h) and `b` (6 h), started at 09:00; the clock is at 10:00. */
function startedTask(): void {
  estimates.files.set('plan.yaml', plan([{ id: 'a', group: 'a', likely: 4 }, { id: 'b', group: 'b', likely: 6 }]));
  app.tasks.create({ title: 'Webhook' });
  app.estimates.save({ file: 'plan.yaml' });
  plans.readings = [
    { project: 'api', root: ROOT, flow: 'openspec', changes: [{ change: 'a', archived: false, done: 0, total: 2 }, { change: 'b', archived: false, done: 0, total: 3 }], archived: [] },
  ];
  app.tasks.start({ at: time('09:00') });
}

const records = (task = 'T-1') => journal.readRecords(T(task));
const events = (task = 'T-1') => tasks.journals.get(task)?.map((e) => e.type) ?? [];

beforeEach(() => {
  const files = new InMemoryProjectFiles();
  tasks = new InMemoryTaskRepository();
  journal = new InMemoryEventJournal();
  estimates = new InMemoryEstimateReader();
  clock = new FixedClock('2026-10-27T10:00:00.000Z');
  plans = new FakeProjectPlans();
  bindings = new InMemorySessionBindings();
  closing = fakeClosing();
  closing.code.heads.set(ROOT, 'h0');
  app = createEstimetry({
    tasks,
    projects: new InMemoryProjectRepository(),
    workspace: new FakeWorkspaceLocator(ROOT),
    authors: new FakeAuthorProvider(),
    taskTypes: new InMemoryTaskTypeCatalog(['feature', 'integration']),
    clock,
    ids: new SequentialIdGenerator(),
    journal,
    measurement: new FixedMeasurementSettings(),
    estimates,
    projectConfig: new InMemoryProjectConfigFile(files),
    install: fakeInstallDependencies(files),
    sessionBindings: bindings, taskStatus: new RepositoryTaskStatusReader(tasks),
    plans,
    ...closingPorts(closing),
  });
});

describe('start', () => {
  it('records the plan and HEAD when work starts', () => {
    startedTask();
    expect(records()).toMatchObject([
      { type: 'plan.started', data: { projects: [{ project: 'api', head: 'h0', changes: [{ change: 'a', done: 0 }, { change: 'b', done: 0 }] }] } },
    ]);
  });
});

describe('close', () => {
  it('summarises before closing, then writes the measurements, closes and writes the card and calibration', () => {
    startedTask();
    journal.append(activity('turn.started', '09:00', { origin: 'user' }));
    journal.append(activity('turn.ended', '09:25'));
    plans.readings = [{ ...plans.readings[0]!, changes: [{ change: 'a', archived: true, archivedOn: '2026-10-27', done: 2, total: 2 }, { change: 'b', archived: false, done: 1, total: 3 }] }];
    expect(app.closing.summary({})).toMatchObject({ fact: 25, estimateHours: 10, planDone: 60, unfinishedGroups: ['b'] });

    const closed = app.closing.close({});
    expect(closed).toMatchObject({ outcome: 'completed', fact: 25, warnings: [] });
    expect(records().map((r) => r.type)).toEqual(['plan.started', 'code.measured', 'plan.closing']);
    expect(records()[2]).toMatchObject({ data: { done: 60, completedGroups: ['a'], unfinishedGroups: ['b'] } });
    expect(events().at(-1)).toBe('task.closed');
    const card = closing.cards.cards.get('T-1');
    expect(card).toMatchObject({ outcome: 'completed', fact: { totalMinutes: 25 }, retro: 'pending', partsFact: 'by-checkboxes' });
    // Two boxes of `a` and one of `b` closed since the plan at the start: 25 minutes split 2:1.
    expect(card?.parts.map((p) => p.factMinutes)).toEqual([17, 8]);
    expect(closing.calibration.current?.authors['dev@example.com']?.ratio.overall.n).toBe(1);
  });

  it('refuses a closing moment before the last record and writes nothing', () => {
    startedTask();
    app.measuring.extra({ category: 'rework', description: 'late fix' });
    expect(() => app.closing.close({ at: time('09:30') })).toThrow(/before the last record/);
    expect(records().map((r) => r.type)).toEqual(['plan.started']);
  });

  it('keeps the task open when the measurements cannot be written, so the next attempt closes it whole', () => {
    startedTask();
    const append = journal.appendRecord.bind(journal);
    journal.appendRecord = () => {
      throw new Error('disk full');
    };
    expect(() => app.closing.close({})).toThrow('disk full');
    expect(app.tasks.show({ task: T('T-1') }).status).toBe('in-progress');
    journal.appendRecord = append;
    expect(app.closing.close({}).outcome).toBe('completed');
  });

  it('closes even when the calibration fails, with a warning', () => {
    startedTask();
    closing.calibration.fail = true;
    const closed = app.closing.close({});
    expect(app.tasks.show({ task: T('T-1') }).status).toBe('closed');
    expect(closed.warnings).toEqual([expect.stringMatching(/calibration\.json.*emt rebuild/)]);
  });

  it('closes an abandoned task, which calibration leaves out', () => {
    startedTask();
    journal.append(activity('turn.started', '09:00', { origin: 'user' }));
    journal.append(activity('turn.ended', '09:30'));
    app.closing.close({ abandoned: true });
    expect(closing.cards.cards.get('T-1')?.outcome).toBe('abandoned');
    expect(closing.calibration.current?.authors['dev@example.com']?.ratio.overall).toMatchObject({ n: 0, excluded: { abandoned: 1 } });
  });

  it('unbinds the sessions of the task at the closing moment, and the pending proposal goes', () => {
    startedTask();
    bindings.update(SessionId.parse('s1'), () => ({ session: 's1', project: 'api', root: ROOT, task: 'T-1', since: time('09:00').toISOString(), everBound: true }));
    closing.proposals.put('T-1', { change: 'a', completedAt: time('09:40').toISOString(), session: 's1' });
    app.closing.close({});
    expect(bindings.get(SessionId.parse('s1'))).toMatchObject({ closedTask: 'T-1', everBound: true });
    expect(bindings.get(SessionId.parse('s1'))?.task).toBeUndefined();
    expect(journal.readActivity(T('T-1')).at(-1)).toMatchObject({ type: 'session.unbound', ts: time('10:00').toISOString() });
    expect(closing.proposals.peek('T-1')).toBeUndefined();
  });

  it('measures code by recorded commits still reachable from HEAD, plus what is not committed', () => {
    startedTask();
    const commit = (sha: string, parents: string[], added: number): CommitRecorded =>
      ({
        schemaVersion: 1,
        id: `c-${sha}`,
        ts: time('09:30').toISOString(),
        type: 'commit.recorded',
        author: 'dev@example.com',
        task: 'T-1',
        project: 'api',
        data: { source: 'git', sha, parents, patchId: `p-${sha}`, authoredAt: time('09:30').toISOString(), committedAt: time('09:30').toISOString(), files: [{ path: 'src/a.ts', added, deleted: 0 }], fileCount: 1, truncated: false },
      }) as CommitRecorded;
    journal.appendRecord(commit('c1', ['h0'], 10));
    journal.appendRecord(commit('c2', ['h0'], 12));
    closing.code.reachableShas.set(ROOT, new Set(['c2']));
    closing.code.pending.set(ROOT, [{ path: 'test/a.test.ts', added: 5, deleted: 0 }]);
    closing.code.authored.set(ROOT, [{ sha: 'c2', files: [] }, { sha: 'x9', files: [{ path: 'src/b.ts', added: 4, deleted: 0 }] }]);
    app.closing.close({});
    const card = closing.cards.cards.get('T-1');
    // c2 recorded and reachable, x9 never recorded but the author's: both count; c1 was rewritten.
    expect(card?.code?.lines).toMatchObject({ production: { added: 16 }, tests: { added: 5 } });
    expect(card?.code?.projects).toEqual([{ source: 'commits', unreachable: 1, uncovered: 1, truncated: false }]);
  });

  it('marks a closed task for every later record', () => {
    startedTask();
    app.closing.close({});
    expect(() => app.measuring.extra({ task: T('T-1'), category: 'rework', description: 'x' })).toThrow(TaskClosed);
    expect(() => app.measuring.manual({ task: T('T-1'), kind: 'user', duration: Duration.ofMinutes(5), description: 'x' })).toThrow(TaskClosed);
    expect(app.tasks.list({}).map((t) => t.id)).toEqual([]);
    expect(app.tasks.list({ closed: true }).map((t) => t.id)).toEqual(['T-1']);
    expect(app.measuring.status({ task: T('T-1') }).task.closedAt).toBe(time('10:00').toISOString());
    expect(app.tasks.show({ task: T('T-1') }).card?.outcome).toBe('completed');
  });
});

describe('session logs at the closing', () => {
  const ms = (hhmm: string) => time(hhmm).toMillis();
  const reader = () => closing.logs.readers.get('claude-code') as FakeSessionLogs;
  const logRead = (end: string, size: number): SessionLogRead => ({
    status: 'read',
    from: 0,
    next: 0,
    turns: [{ key: 0, start: ms('09:00'), end: ms(end), tokens: [{ at: ms('09:00'), model: 'm', input: 0, output: 100, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }] }],
    agents: [],
    cost: [{ startTime: 1, totalUSD: 3, unknown: false }],
    skipped: 0,
    fingerprint: { main: { size, mtimeMs: size }, agents: {} },
  });

  it('imports the log of every session of the task before task.closed; the card has its tokens and cost', () => {
    startedTask();
    journal.append(activity('turn.started', '09:00', { origin: 'user', source: 'claude-code' }));
    journal.append(activity('tool.used', '09:10', { source: 'claude-code' }));
    reader().logs.set('s1', logRead('09:25', 10));
    const closed = app.closing.close({});
    expect(closed).toMatchObject({ fact: 25, warnings: [] }); // the turn without its end closes where the log ends it
    expect(records().map((r) => r.type)).toEqual(['plan.started', 'log.session', 'code.measured', 'plan.closing']);
    expect(closing.cards.cards.get('T-1')?.usage).toMatchObject({ costUSD: 3, approximate: false, sessions: 1, withLogs: 1, tokens: { m: { output: 100 } } });
  });

  it('writes nothing into a closed task, and a reopened task gets the rest of the log at its next closing', () => {
    startedTask();
    journal.append(activity('turn.started', '09:00', { origin: 'user', source: 'claude-code' }));
    journal.append(activity('turn.ended', '09:05', { source: 'claude-code' }));
    reader().logs.set('s1', logRead('09:05', 10));
    app.closing.close({});
    reader().logs.set('s1', logRead('09:06', 20));
    clock.advanceMinutes(30);
    app.closing.reopen({ task: T('T-1') });
    clock.advanceMinutes(30);
    app.closing.close({});
    expect(records().filter((r) => r.type === 'log.session')).toHaveLength(2);
  });

  it('a log that cannot be read is a warning, not a refusal', () => {
    startedTask();
    journal.append(activity('turn.started', '09:00', { origin: 'user', source: 'claude-code' }));
    journal.append(activity('turn.ended', '09:05', { source: 'claude-code' }));
    reader().logs.set('s1', logRead('09:05', 10));
    reader().read = () => {
      throw new Error('broken');
    };
    const closed = app.closing.close({});
    expect(closed.outcome).toBe('completed');
    expect(closed.warnings).toEqual(['the log of session s1 was not imported (failed); the fact goes without it']);
  });
});

describe('reopen and retro', () => {
  it('reopens a task, removes its card and marks an earlier retro stale at the next closing', () => {
    startedTask();
    app.closing.close({});
    app.closing.retro({ reasons: ['a: harder than it looked'], lesson: 'split the change' });
    expect(closing.cards.cards.get('T-1')?.retro).toEqual({ status: 'current', reasons: [{ part: 0 }] });
    clock.advanceMinutes(30);
    app.closing.reopen({ task: T('T-1') });
    expect(closing.cards.cards.get('T-1')).toBeUndefined();
    clock.advanceMinutes(30);
    app.closing.close({});
    expect(closing.cards.cards.get('T-1')).toMatchObject({ retro: { status: 'stale' }, closedMinutes: 30 });
  });

  it('records a retro of the task closed last, replaces it, and refuses a task in progress', () => {
    startedTask();
    expect(() => app.closing.retro({ task: T('T-1'), reasons: ['x'], lesson: 'y' })).toThrow(TaskNotClosed);
    app.closing.close({});
    app.closing.retro({ reasons: ['note: API changed twice'], lesson: 'first' });
    const second = app.closing.retro({ reasons: ['b: tests took long'], lesson: 'second' });
    expect(second).toMatchObject({ reasons: [{ text: 'tests took long', part: 'b' }], lesson: 'second' });
  });
});

describe('the working copy of a request', () => {
  it('reads the plan where the request comes from: at the start, in the status, the summary and the closing', () => {
    estimates.files.set('plan.yaml', plan([{ id: 'a', group: 'a', likely: 4 }]));
    app.tasks.create({ title: 'Webhook' });
    app.estimates.save({ file: 'plan.yaml' });
    plans.nears.length = 0;
    app.tasks.start({ at: time('09:00'), near: '/work/api-2' });
    app.measuring.status({ near: '/work/api-2' });
    app.closing.summary({ near: '/work/api-2' });
    app.closing.close({ near: '/work/api-2' });
    expect(plans.nears.length).toBeGreaterThan(3);
    expect(new Set(plans.nears)).toEqual(new Set(['/work/api-2']));
  });
});

describe('renegotiate', () => {
  it('names the task that would close before anything is written', () => {
    startedTask();
    expect(app.closing.renegotiationTarget({})).toMatchObject({ id: 'T-1', status: 'in-progress' });
    expect(events().at(-1)).toBe('task.started');
  });


  it('creates the spawned task, records the renegotiated extra and closes the original', () => {
    startedTask();
    const result = app.closing.renegotiate({ title: 'Webhooks v2', description: 'retry policy added' });
    expect(result.spawned).toMatchObject({ id: 'T-2', spawnedFrom: 'T-1', status: 'new', type: 'feature' });
    expect(result.closed).toMatchObject({ outcome: 'renegotiated', task: { spawned: 'T-2' } });
    expect(events().slice(-2)).toEqual(['task.extra-recorded', 'task.closed']);
  });

  it('reuses a spawned task left by a failed attempt and records the extra once', () => {
    startedTask();
    const save = tasks.save.bind(tasks);
    let failOnce = true;
    tasks.save = (task) => {
      if (task.id.toString() === 'T-1' && failOnce) {
        failOnce = false;
        throw new Error('crash');
      }
      save(task);
    };
    expect(() => app.closing.renegotiate({ title: 'Webhooks v2' })).toThrow('crash');
    tasks.save = save;
    app.closing.renegotiate({ title: 'Webhooks v2' });
    expect(app.tasks.list({ all: true, closed: true }).map((t) => t.id)).toEqual(['T-1', 'T-2']);
    expect(events().filter((e) => e === 'task.extra-recorded')).toHaveLength(1);
  });
});

describe('rebuild', () => {
  it('writes the cards again and goes on past a broken task', () => {
    startedTask();
    app.closing.close({});
    app.tasks.create({ title: 'Broken' });
    tasks.broken.add('T-2');
    closing.cards.cards.clear();
    const report = app.closing.rebuild({});
    expect(report).toMatchObject({ tasks: 2, cards: 1, failed: [{ task: 'T-2' }] });
    expect(closing.cards.cards.get('T-1')).toBeDefined();
  });
});
