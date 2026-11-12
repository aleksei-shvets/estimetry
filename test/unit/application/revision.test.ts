import { beforeEach, describe, expect, it } from 'vitest';
import { createEstimetry, type Estimetry } from '../../../src/application/estimetry.js';
import { ChangeCompletions } from '../../../src/application/hooks/change-completions.js';
import { MeasuredTaskFacts } from '../../../src/application/hooks/task-facts.js';
import { TaskMeasurement } from '../../../src/application/task/task-measurement.js';
import { TaskPlanProgress } from '../../../src/application/task/task-plan-progress.js';
import type { Card } from '../../../src/domain/card/card.js';
import type { CardV1 } from '../../../src/domain/card/card-v1.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { CalendarDate } from '../../../src/domain/shared/calendar-date.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { activity } from '../../support/activity.js';
import { closingPorts, fakeClosing } from '../../support/closing-fakes.js';
import {
  FakeAuthorProvider,
  FakeWorkspaceLocator,
  FixedClock,
  FixedMeasurementSettings,
  InMemoryEstimateReader,
  InMemoryTaskTypeCatalog,
  RecordingErrorReporter,
  SequentialIdGenerator,
} from '../../support/fakes.js';
import { FakeProjectPlans, InMemorySessionBindings, RepositoryTaskStatusReader } from '../../support/hook-fakes.js';
import { fakeInstallDependencies, InMemoryProjectConfigFile, InMemoryProjectFiles } from '../../support/in-memory-files.js';
import { InMemoryEventJournal, InMemoryProjectRepository, InMemoryTaskRepository } from '../../support/in-memory-repositories.js';
import { ChangeArchives } from '../../../src/application/shared/change-archives.js';
import { EventMetaSource } from '../../../src/application/shared/event-meta-source.js';
import { ProgressLog } from '../../../src/application/hooks/progress-log.js';
import { SessionId } from '../../../src/domain/measurement/session-id.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';

let tasks: InMemoryTaskRepository;
let journal: InMemoryEventJournal;
let estimates: InMemoryEstimateReader;
let clock: FixedClock;
let plans: FakeProjectPlans;
let closing: ReturnType<typeof fakeClosing>;
let files: InMemoryProjectFiles;
let app: Estimetry;

const T = TaskId.parse('T-1');
const time = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
const ROOT = '/work/api';

function plan(likely: number, groups: string[] = ['auth', 'billing']): Estimate {
  return Estimate.of({
    parts: groups.map((group) =>
      EstimatePart.of({ id: group, name: group, group, hours: ThreePointEstimate.of({ optimistic: likely, likely, pessimistic: likely }) }),
    ),
  });
}

/** T-1 started at 09:00 with 10 h; agents worked 09:00–09:20 and 10:10–10:30; `auth` archived at 10:00. */
function startedTask(): void {
  estimates.files.set('plan.yaml', plan(5));
  estimates.files.set('plan2.yaml', plan(6));
  app.tasks.create({ title: 'Webhook' });
  app.estimates.save({ file: 'plan.yaml' });
  plans.readings = [
    {
      project: 'api',
      root: ROOT,
      flow: 'openspec',
      changes: [
        { change: 'auth', archived: true, archivedOn: '2026-10-27', done: 2, total: 2 },
        { change: 'billing', archived: false, done: 0, total: 3 },
      ],
      archived: [{ change: 'auth', archivedOn: CalendarDate.parse('2026-10-27'), directory: '2026-10-27-auth', path: `${ROOT}/openspec/changes/archive/2026-10-27-auth` }],
    },
  ];
  app.tasks.start({ at: time('09:00') });
  for (const [start, end] of [['09:00', '09:20'], ['10:10', '10:30']] as const) {
    journal.append(activity('turn.started', start, { origin: 'user' }));
    journal.append(activity('tool.started', start, { toolUseId: `t${start}` }));
    journal.append(activity('tool.used', end, { toolUseId: `t${start}` }));
    journal.append(activity('turn.ended', end));
  }
  journal.appendRecord({
    schemaVersion: 1,
    id: 'done-auth',
    ts: time('10:00').toISOString(),
    type: 'change.completed',
    author: 'dev@example.com',
    task: 'T-1',
    project: 'api',
    data: { source: 'estimetry', project: 'api', change: 'auth', directory: '2026-10-27-auth', flow: 'openspec', completedAt: time('10:00').toISOString(), detectedAt: time('10:00').toISOString(), approximate: false },
  });
}

beforeEach(() => {
  files = new InMemoryProjectFiles();
  tasks = new InMemoryTaskRepository();
  journal = new InMemoryEventJournal();
  estimates = new InMemoryEstimateReader();
  clock = new FixedClock('2026-10-27T11:00:00.000Z');
  plans = new FakeProjectPlans();
  closing = fakeClosing();
  closing.code.heads.set(ROOT, 'h0');
  app = createEstimetry({
    tasks,
    projects: new InMemoryProjectRepository(),
    workspace: new FakeWorkspaceLocator(ROOT),
    authors: new FakeAuthorProvider(),
    taskTypes: new InMemoryTaskTypeCatalog(['feature']),
    clock,
    ids: new SequentialIdGenerator(),
    journal,
    measurement: new FixedMeasurementSettings(),
    estimates,
    projectConfig: new InMemoryProjectConfigFile(files),
    install: fakeInstallDependencies(files),
    sessionBindings: new InMemorySessionBindings(), taskStatus: new RepositoryTaskStatusReader(tasks),
    plans,
    ...closingPorts(closing),
  });
});

const revise = (input: Partial<Parameters<Estimetry['estimates']['revise']>[0]> = {}) =>
  app.estimates.revise({ file: 'plan2.yaml', reason: 'design was wrong', category: 'missed-analysis', spent: 'exclude', lostFrom: time('10:00'), ...input });

describe('revising the estimate', () => {
  it('records the event, the plan snapshot after it, and the archive of the time as excluded', () => {
    startedTask();
    const revised = revise();
    expect(revised).toMatchObject({ spent: 'exclude', lostFrom: time('10:00').toISOString(), excluded: [{ project: 'api', archives: [{ change: 'auth', archivedOn: '2026-10-27' }] }] });
    const event = tasks.journals.get('T-1')?.at(-1);
    expect(event?.type).toBe('task.estimate-revised');
    expect(journal.readRecords(T).at(-1)).toMatchObject({ type: 'plan.revised', data: { revision: event?.id } });
  });

  it('compares the counted fact with the estimate in status, close, session start and parallel mode', () => {
    startedTask();
    revise();
    const status = app.measuring.status({});
    // Agents 09:00–09:20 and 10:10–10:30, the user 10:30–11:00 with the session open: 70 in all.
    // The lost window 10:00–11:00 takes the last agent turn and the user's time out.
    expect(status).toMatchObject({ fact: 70, counted: { fact: 20 }, lost: 50 });
    expect(status.estimateShare).toBeCloseTo(20 / 60 / 12);
    expect(app.closing.summary({}).fact).toBe(20);
    const facts = new MeasuredTaskFacts(tasks, new TaskMeasurement(journal, new FixedMeasurementSettings(), clock), new TaskPlanProgress(plans, journal));
    expect(facts.fact(TaskId.parse('T-1'))?.minutes).toBe(20);
    expect(app.measuring.parallel({ enabled: true }).budgetShare).toBeCloseTo(Math.round((20 / 60 / 12) * 1000) / 1000);
  });

  it('takes the rolled back change out of the plan and of the completed changes, and drops the proposal about it', () => {
    startedTask();
    closing.proposals.put(TaskId.parse('T-1'), { change: 'auth', completedAt: time('10:00'), session: SessionId.parse('s1') });
    expect(app.measuring.status({}).plan?.done).toBe(50);
    revise();
    const status = app.measuring.status({});
    expect(status.plan).toMatchObject({ done: 0, archivedBeforeRevision: ['auth'] });
    expect(status.completedChanges).toEqual([]);
    expect(closing.proposals.peek(TaskId.parse('T-1'))).toBeUndefined();
  });

  it('the hook receiver never records the rolled back archive, also after losing its cache', () => {
    startedTask();
    revise();
    const state = { read: () => undefined, write: () => undefined };
    const completions = new ChangeCompletions(
      new ChangeArchives(plans, { changedAt: () => time('10:00').toMillis() }),
      new ProgressLog(state, journal),
      new RepositoryTaskStatusReader(tasks),
      new EventMetaSource({ now: () => { throw new Error('the clock is not read here'); } }, new SequentialIdGenerator(), new FakeAuthorProvider()),
      new RecordingErrorReporter(),
      closing.proposals,
    );
    const summary = new RepositoryTaskStatusReader(tasks).summary(TaskId.parse('T-1'));
    expect(summary?.exclusions?.archives).toEqual([{ project: 'api', change: 'auth', archivedOn: '2026-10-27' }]);
    completions.check({ ...(summary as NonNullable<typeof summary>), groups: ['auth', 'billing'] }, time('11:30'), ROOT, SessionId.parse('s1'));
    expect(journal.readRecords(T).filter((r) => r.type === 'change.completed')).toHaveLength(1); // only the one from before
    expect(closing.proposals.peek(TaskId.parse('T-1'))).toBeUndefined();
  });

  it('lists extra work since the window and manual time without a moment before writing', () => {
    startedTask();
    app.measuring.extra({ category: 'missed-analysis', description: 'rolled back', time: Duration.ofMinutes(60) });
    app.measuring.manual({ kind: 'user', duration: Duration.ofMinutes(15), description: 'review' });
    const candidates = app.estimates.revisionCandidates({ lostFrom: time('10:00'), spent: 'exclude' });
    expect(candidates.extras.map((e) => e.description)).toEqual(['rolled back']);
    expect(candidates.untimedManual.map((m) => m.minutes)).toEqual([15]);
    const id = candidates.extras[0]?.id as string;
    expect(revise({ covers: [id] }).covers).toEqual([id]);
  });

  it('repairs a revision whose plan snapshot was lost', () => {
    startedTask();
    const append = journal.appendRecord.bind(journal);
    journal.appendRecord = () => {
      throw new Error('disk full');
    };
    expect(() => revise()).toThrow('disk full');
    journal.appendRecord = append;
    expect(app.measuring.status({}).revisions[0]?.missingSnapshot).toBe(true);
    expect(app.estimates.repairRevision({}).revision).toBe(tasks.journals.get('T-1')?.at(-1)?.id);
    expect(app.measuring.status({}).revisions[0]?.missingSnapshot).toBe(false);
    expect(() => app.estimates.repairRevision({})).toThrow(/nothing to repair/);
  });

  it('excludes only what was archived inside the lost window, not before it or after a backdated revision', () => {
    startedTask();
    const reading = plans.readings[0]!;
    const dir = (change: string) => ({ change, archivedOn: CalendarDate.parse('2026-10-27'), directory: `2026-10-27-${change}`, path: `${ROOT}/openspec/changes/archive/2026-10-27-${change}` });
    plans.readings = [{ ...reading, archived: [dir('auth'), dir('early'), dir('late')] }];
    files.changed.set(dir('auth').path, time('10:20').toMillis());
    files.changed.set(dir('early').path, time('09:30').toMillis());
    files.changed.set(dir('late').path, time('10:50').toMillis());
    const revised = revise({ lostFrom: time('10:00'), at: time('10:40') });
    expect(revised.excluded).toEqual([{ project: 'api', archives: [{ change: 'auth', archivedOn: '2026-10-27', changedAt: time('10:20').toMillis() }] }]);
  });

  it('keeps a proposal about a change of the same name in another project', () => {
    startedTask();
    closing.proposals.put(TaskId.parse('T-1'), { change: 'auth', project: ProjectId.parse('web'), completedAt: time('10:00'), session: SessionId.parse('s1') });
    revise();
    expect(closing.proposals.peek(TaskId.parse('T-1'))?.project?.value).toBe('web');
  });

  it('renegotiates after a revision with the counted fact', () => {
    startedTask();
    revise();
    expect(app.closing.renegotiate({ title: 'Next' }).closed.fact).toBe(20);
  });

  it('closes into a card v3: the counted fact, the work of the window and the counted fact at the revision', () => {
    startedTask();
    revise();
    closing.code.heads.set(ROOT, 'h1');
    app.closing.close({});
    const card = closing.cards.cards.get('T-1');
    expect(card).toMatchObject({
      schemaVersion: 3,
      estimate: { likelyHours: 10 },
      currentEstimate: { likelyHours: 12 },
      fact: { totalMinutes: 70, counted: { totalMinutes: 20 } },
      revisions: [{ spent: 'exclude', lostMinutes: 50, countedAtMinutes: 20 }],
    });
    expect(closing.calibration.current?.schemaVersion).toBe(2);
  });

  it('in parallel mode the work of the window is measured as the sequential equivalent, like the main ratio', () => {
    startedTask();
    app.measuring.parallel({ enabled: true, agents: 2 });
    app.measuring.parallel({ enabled: false });
    revise();
    app.closing.close({});
    const card = closing.cards.cards.get('T-1') as Card;
    expect(card.parallel.used).toBe(true);
    expect(card.revisions[0]?.lostMinutes).toBe((card.parallel.sequentialMinutes ?? 0) - (card.fact.counted.sequentialMinutes ?? 0));
  });

  it('refuses --covers with include', () => {
    startedTask();
    app.measuring.extra({ category: 'rework', description: 'x', time: Duration.ofMinutes(10) });
    const id = tasks.journals.get('T-1')?.at(-1)?.id as string;
    expect(() => app.estimates.revise({ file: 'plan2.yaml', reason: 'x', category: 'rework', spent: 'include', covers: [id] })).toThrow(/only with --spent exclude/);
  });
});

describe('cards of other schemas', () => {
  const closeT1 = () => {
    startedTask();
    revise();
    app.closing.close({});
  };

  it('a card of schema 1 is rebuilt from the journal and written again on recalculation and in task show', () => {
    closeT1();
    const current = closing.cards.cards.get('T-1') as Card;
    closing.cards.cards.delete('T-1');
    closing.cards.others.set('T-1', { schema: 'v1', card: { ...current, schemaVersion: 1 } as unknown as CardV1 });
    app.closing.rebuild({ task: TaskId.parse('T-2') });
    expect(closing.cards.cards.get('T-1')?.schemaVersion).toBe(3);
    expect(closing.calibration.current?.authors['dev@example.com']?.revised.overall.n).toBe(1);
    closing.cards.cards.delete('T-1');
    closing.cards.others.set('T-1', { schema: 'v1', card: { ...current, schemaVersion: 1 } as unknown as CardV1 });
    expect(app.tasks.show({ task: T }).card?.schemaVersion).toBe(3);
    expect(closing.cards.cards.has('T-1')).toBe(true);
  });

  it('a card newer than this binary stops the recalculation and is reported', () => {
    closeT1();
    const before = closing.calibration.current;
    closing.cards.others.set('T-9', { schema: 'newer', task: TaskId.parse('T-9'), version: 4 });
    const report = app.closing.rebuild({ task: T });
    expect(report.calibrationError).toMatch(/T-9 were written by a newer version of estimetry/);
    expect(closing.calibration.current).toBe(before);
    expect((closing.errors as RecordingErrorReporter).reports.map((r) => r.context)).toContain('calibration');
  });

  it('a rebuilt card that cannot be written still counts as rebuilt; a broken card of schema 1 is left out', () => {
    closeT1();
    const current = closing.cards.cards.get('T-1') as Card;
    closing.cards.cards.delete('T-1');
    closing.cards.others.set('T-1', { schema: 'v1', card: { ...current, schemaVersion: 1 } as unknown as CardV1 });
    closing.cards.others.set('T-5', { schema: 'v1', card: { ...current, schemaVersion: 1, task: { ...current.task, id: 'T-5' }, parallel: undefined } as unknown as CardV1 });
    closing.cards.failWrite = true;
    app.closing.rebuild({ task: TaskId.parse('T-2') });
    expect(closing.calibration.current?.authors['dev@example.com']).toMatchObject({ tasks: 1, revised: { overall: { n: 1 } } });
    const contexts = (closing.errors as RecordingErrorReporter).reports.map((r) => r.context);
    expect(contexts).toEqual(expect.arrayContaining(['writing the card of T-1', 'reading the card of T-5']));
  });

  it('closing next to a newer card warns to update estimetry, not to rebuild', () => {
    closing.cards.others.set('T-9', { schema: 'newer', task: TaskId.parse('T-9'), version: 4 });
    startedTask();
    const closed = app.closing.close({});
    expect(closed.warnings).toEqual([expect.stringMatching(/newer version of estimetry.*update estimetry\)$/)]);
  });
});

