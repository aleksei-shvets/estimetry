import { beforeEach, describe, expect, it } from 'vitest';
import { createEstimetry, type Estimetry } from '../../../src/application/estimetry.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { InvalidEstimate } from '../../../src/domain/estimate/invalid-estimate.js';
import type { PartKind } from '../../../src/domain/estimate/part-kind.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import {
  AmbiguousTask,
  EstimateLocked,
  ParallelModeConflict,
  TaskNotStarted,
  UnknownTaskType,
} from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { activity } from '../../support/activity.js';
import {
  FakeAuthorProvider,
  FakeWorkspaceLocator,
  FixedClock,
  FixedMeasurementSettings,
  InMemoryEstimateReader,
  InMemoryTaskTypeCatalog,
  SequentialIdGenerator,
} from '../../support/fakes.js';
import {
  InMemoryEventJournal,
  InMemoryProjectRepository,
  InMemoryTaskRepository,
} from '../../support/in-memory-repositories.js';

let tasks: InMemoryTaskRepository;
let journal: InMemoryEventJournal;
let estimates: InMemoryEstimateReader;
let clock: FixedClock;
let settings: FixedMeasurementSettings;
let app: Estimetry;

const T = (id: string) => TaskId.parse(id);
const time = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);

function estimate(parts: { id: string; likely: number; kind?: PartKind }[], type?: string): Estimate {
  return Estimate.of({
    parts: parts.map((part) =>
      EstimatePart.of({
        id: part.id,
        name: part.id,
        ...(part.kind ? { kind: part.kind } : {}),
        hours: ThreePointEstimate.of({ optimistic: part.likely / 2, likely: part.likely, pessimistic: part.likely * 2 }),
      }),
    ),
    ...(type ? { type } : {}),
  });
}

/** A started task T-1 with an estimate of `likely` hours, started at 09:00; the clock is at 10:00. */
function startedTask(likely = 10): void {
  estimates.files.set('plan.yaml', estimate([{ id: 'impl', likely }]));
  app.createTask({ title: 'Webhook' });
  app.saveEstimate({ file: 'plan.yaml' });
  app.startTask({ at: time('09:00') });
}

beforeEach(() => {
  tasks = new InMemoryTaskRepository();
  journal = new InMemoryEventJournal();
  estimates = new InMemoryEstimateReader();
  clock = new FixedClock('2026-10-27T10:00:00.000Z');
  settings = new FixedMeasurementSettings();
  app = createEstimetry({
    tasks,
    projects: new InMemoryProjectRepository(),
    workspace: new FakeWorkspaceLocator('/work/api'),
    authors: new FakeAuthorProvider(),
    taskTypes: new InMemoryTaskTypeCatalog(['feature', 'integration']),
    clock,
    ids: new SequentialIdGenerator(),
    journal,
    measurement: settings,
    estimates,
  });
});

describe('saveEstimate', () => {
  it('makes the estimate the plan of the only new task and reports missing testing parts', () => {
    app.createTask({ title: 'Webhook', type: 'feature' });
    estimates.files.set('plan.yaml', estimate([{ id: 'impl', likely: 2 }, { id: 'tests', likely: 1, kind: 'auto-tests' }], 'integration'));
    const saved = app.saveEstimate({ file: 'plan.yaml' });
    expect(saved).toMatchObject({
      task: { id: 'T-1', status: 'estimated', estimated: true, type: 'integration' },
      total: { optimistic: 1.5, likely: 3, pessimistic: 6 },
      parts: 2,
      missingKinds: ['manual-testing'],
    });
    expect(app.startTask({}).estimated).toBe(true);
  });

  it('replaces the estimate before the start and refuses after it', () => {
    startedTask();
    expect(() => app.saveEstimate({ file: 'plan.yaml', task: T('T-1') })).toThrow(EstimateLocked);
    expect(tasks.journals.get('T-1')?.filter((e) => e.type === 'task.estimated')).toHaveLength(1);
  });

  it('checks the type of the estimate against the catalog before touching the task', () => {
    app.createTask({ title: 'Webhook' });
    estimates.files.set('plan.yaml', estimate([{ id: 'impl', likely: 1 }], 'banana'));
    expect(() => app.saveEstimate({ file: 'plan.yaml' })).toThrow(UnknownTaskType);
    expect(() => app.saveEstimate({ file: 'missing.yaml' })).toThrow(InvalidEstimate);
    expect(tasks.journals.get('T-1')).toHaveLength(1);
  });

  it('needs a single candidate when no task is given', () => {
    app.createTask({ title: 'A' });
    app.createTask({ title: 'B' });
    estimates.files.set('plan.yaml', estimate([{ id: 'impl', likely: 1 }]));
    expect(() => app.saveEstimate({ file: 'plan.yaml' })).toThrow(AmbiguousTask);
    expect(app.saveEstimate({ file: 'plan.yaml', task: T('T-2') }).task.id).toBe('T-2');
  });
});

describe('startTask --at', () => {
  it('backdates the start, but not into the future', () => {
    app.createTask({ title: 'Webhook' });
    expect(() => app.startTask({ at: time('10:01') })).toThrow(InvalidValue);
    expect(app.startTask({ at: Timestamp.parse('2026-10-26T09:00:00.000Z') }).startedAt).toBe('2026-10-26T09:00:00.000Z');
  });
});

describe('recordManualTime', () => {
  it('records into the only task in progress', () => {
    startedTask();
    const recorded = app.recordManualTime({ kind: 'user', duration: Duration.ofMinutes(40), description: 'manual testing' });
    expect(recorded).toMatchObject({ task: { id: 'T-1' }, kind: 'user', minutes: 40, overlapsMeasured: false });
    expect(app.showStatus({}).userTime).toBe(40);
  });

  it('warns when a record without an end falls on measured time', () => {
    startedTask();
    journal.append(activity('turn.started', '09:30', { origin: 'user' }));
    journal.append(activity('turn.ended', '09:35'));
    const recorded = app.recordManualTime({ kind: 'user', duration: Duration.ofMinutes(40), description: 'call yesterday' });
    expect(recorded.overlapsMeasured).toBe(true);
    expect(app.showStatus({}).userTime).toBe(65); // 25 measured + 40 on top
  });

  it('does not warn when the record has an end', () => {
    startedTask();
    journal.append(activity('turn.started', '09:30', { origin: 'user' }));
    journal.append(activity('turn.ended', '09:35'));
    const recorded = app.recordManualTime({ kind: 'user', duration: Duration.ofMinutes(25), at: time('10:00'), description: 'x' });
    expect(recorded.overlapsMeasured).toBe(false);
    expect(app.showStatus({}).userTime).toBe(25);
  });

  it('refuses an end in the future or before the start, and a task that is not started', () => {
    startedTask();
    const record = (at: Timestamp) => app.recordManualTime({ kind: 'user', duration: Duration.ofMinutes(5), at, description: 'x' });
    expect(() => record(time('10:30'))).toThrow(/future/);
    expect(() => record(time('08:59'))).toThrow(InvalidValue);
    // Ends after the start, but would begin before it.
    expect(() => app.recordManualTime({ kind: 'user', duration: Duration.ofMinutes(30), at: time('09:20'), description: 'x' })).toThrow(/must lie after the task started/);
    app.createTask({ title: 'Other' });
    expect(() =>
      app.recordManualTime({ task: T('T-2'), kind: 'user', duration: Duration.ofMinutes(5), description: 'x' }),
    ).toThrow(TaskNotStarted);
  });

  it('needs exactly one task in progress when none is given', () => {
    expect(() => app.recordManualTime({ kind: 'user', duration: Duration.ofMinutes(5), description: 'x' })).toThrow(AmbiguousTask);
  });
});

describe('recordExtra', () => {
  it('records absorbed extra work without changing the fact', () => {
    startedTask();
    const recorded = app.recordExtra({ category: 'environment', description: 'Node 21', time: Duration.ofMinutes(30) });
    expect(recorded.extra).toMatchObject({ category: 'environment', accounting: 'absorbed', timeMs: 1_800_000 });
    const status = app.showStatus({});
    expect(status.fact).toBe(0);
    expect(status.records).toEqual({ manual: 0, extras: 1, extraMinutesByCategory: { environment: 30 } });
  });

  it('rejects an unknown category', () => {
    startedTask();
    expect(() => app.recordExtra({ category: 'oops', description: 'x' })).toThrow(/expected one of/);
  });
});

describe('changeParallelMode', () => {
  it('records the share of the budget spent when switched on', () => {
    startedTask(10);
    app.recordManualTime({ kind: 'agent', duration: Duration.ofHours(6), description: 'agents' });
    const changed = app.changeParallelMode({ enabled: true, reason: 'deadline', agents: 3 });
    expect(changed).toMatchObject({ enabled: true, budgetShare: 0.6 });
    expect(() => app.changeParallelMode({ enabled: true })).toThrow(ParallelModeConflict);
    expect(app.changeParallelMode({ enabled: false }).enabled).toBe(false);
    expect(() => app.changeParallelMode({ enabled: false })).toThrow(ParallelModeConflict);
    expect(app.showStatus({}).parallel).toEqual({ used: true, maxAgents: 3, sequentialEquivalent: 360 });
  });

  it('has no budget share without an estimate', () => {
    app.createTask({ title: 'X' });
    app.startTask({});
    expect(app.changeParallelMode({ enabled: true }).budgetShare).toBeUndefined();
  });
});

describe('showStatus', () => {
  it('computes the fact from the journal with the configured threshold', () => {
    startedTask(1);
    journal.append(activity('turn.started', '09:00', { origin: 'user' }));
    journal.append(activity('turn.ended', '09:10'));
    journal.append(activity('turn.started', '09:50', { origin: 'user' }));
    journal.append(activity('turn.ended', '10:00'));
    expect(app.showStatus({})).toMatchObject({ agentTime: 20, userTime: 0, fact: 20, uncertainty: 40 });
    settings.minutes = 60;
    expect(app.showStatus({})).toMatchObject({
      task: { id: 'T-1', status: 'in-progress', startedAt: '2026-10-27T09:00:00.000Z' },
      agentTime: 20,
      userTime: 40,
      fact: 60,
      estimate: { likely: 1 },
      estimateShare: 1,
      calendar: 60,
    });
  });

  it('shows a task that is not started yet with zero fact and no shares', () => {
    app.createTask({ title: 'X' });
    expect(app.showStatus({ task: T('T-1') })).toMatchObject({
      fact: 0,
      uncertainty: 0,
      uncertaintyShare: null,
      manualShare: null,
      estimate: null,
      estimateShare: null,
    });
  });
});
