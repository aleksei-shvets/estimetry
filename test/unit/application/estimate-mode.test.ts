import { beforeEach, describe, expect, it } from 'vitest';
import { createEstimetry, type Estimetry } from '../../../src/application/estimetry.js';
import type { CardV1 } from '../../../src/domain/card/card-v1.js';
import { Project } from '../../../src/domain/project/project.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { UnknownTaskType } from '../../../src/domain/task/task-errors.js';
import { syntheticCard } from '../../support/cards.js';
import { fakeClosing } from '../../support/closing-fakes.js';
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

const ROOT = '/work/api';
let closing: ReturnType<typeof fakeClosing>;
let projects: InMemoryProjectRepository;
let aliases: string[];
let app: Estimetry;

beforeEach(() => {
  const files = new InMemoryProjectFiles();
  const tasks = new InMemoryTaskRepository();
  aliases = [];
  closing = fakeClosing({ settings: { minTasks: () => 5, authorAliases: () => aliases } });
  projects = new InMemoryProjectRepository();
  app = createEstimetry({
    tasks,
    projects,
    workspace: new FakeWorkspaceLocator(ROOT),
    authors: new FakeAuthorProvider(),
    taskTypes: new InMemoryTaskTypeCatalog(['feature', 'research']),
    clock: new FixedClock('2026-11-02T11:00:00.000Z'),
    ids: new SequentialIdGenerator(),
    journal: new InMemoryEventJournal(),
    measurement: new FixedMeasurementSettings(),
    estimates: new InMemoryEstimateReader(),
    projectConfig: new InMemoryProjectConfigFile(files),
    install: fakeInstallDependencies(files),
    sessions: { bindings: new InMemorySessionBindings(), tasks: new RepositoryTaskStatusReader(tasks) },
    plans: new FakeProjectPlans(),
    closing,
    workspaceDir: ROOT,
  });
});

const put = (...cards: ReturnType<typeof syntheticCard>[]) => cards.forEach((card) => closing.cards.cards.set(card.task.id, card));
const registered = (stack: string[]) =>
  projects.projects.push(
    Project.register({ id: ProjectId.parse('api'), name: 'api', path: ROOT }, Author.of('dev@example.com'), Timestamp.fromMillis(0)).withStack(stack),
  );

describe('emt similar', () => {
  it('takes the stack of the current project when none is given', () => {
    registered(['flutter', 'bloc']);
    put(syntheticCard({ id: 'T-1', type: 'research', stack: ['flutter'] }));
    const view = app.similarTasks({ type: 'feature' });
    expect(view.query).toEqual({ type: 'feature', stack: ['bloc', 'flutter'], hours: null });
    expect(view.tasks.map((t) => t.id)).toEqual(['T-1']);
    expect(view.schemaVersion).toBe(1);
  });

  it('refuses an unknown type and a query with nothing to compare by', () => {
    expect(() => app.similarTasks({ type: 'feture' })).toThrow(UnknownTaskType);
    expect(() => app.similarTasks({})).toThrow(/--type <type> or --stack <labels>/);
  });

  it('counts cards of an alias as the author’s and names cards of other authors', () => {
    put(syntheticCard({ id: 'T-1', author: 'old@example.com' }), syntheticCard({ id: 'T-2', author: 'someone@example.com' }));
    expect(app.similarTasks({ type: 'feature' })).toMatchObject({ tasks: [], otherAuthors: 2 });
    aliases = ['old@example.com'];
    expect(app.similarTasks({ type: 'feature' })).toMatchObject({ tasks: [{ id: 'T-1' }], otherAuthors: 1 });
  });

  it('names cards of a newer estimetry and compares the rest', () => {
    put(syntheticCard({ id: 'T-1' }));
    closing.cards.others.set('T-9', { schema: 'newer', task: 'T-9', version: 4 });
    expect(app.similarTasks({ type: 'feature' })).toMatchObject({ tasks: [{ id: 'T-1' }], skipped: ['T-9'] });
  });
});

describe('emt calibrate', () => {
  const six = () => Array.from({ length: 6 }, (_, i) => syntheticCard({ id: `T-${i + 1}`, stack: ['flutter'], ratio: 1.3 }));

  it('gives the applicable coefficient with the slices of the query, and an empty slice for an unknown label', () => {
    put(...six());
    const view = app.calibration({ type: 'feature', stack: ['flutter', 'bloc'] });
    expect(view.coefficient).toEqual({ value: 1.3, slice: { kind: 'type', key: 'feature' }, n: 6 });
    expect(view.ratio.byStack['bloc']).toMatchObject({ n: 0, applicable: false });
    expect(view.ratio.byType['feature']?.n).toBe(6);
    expect(view).toMatchObject({ schemaVersion: 1, minTasks: 5, tasks: 6 });
  });

  it('writes nothing: neither calibration.json nor a card of schema 1', () => {
    put(...six());
    const v1 = { ...syntheticCard({ id: 'T-7' }), schemaVersion: 1 } as unknown as CardV1;
    closing.cards.others.set('T-7', { schema: 'v1', card: v1 });
    app.calibration({ type: 'feature' });
    expect(closing.calibration.current).toBeUndefined();
    expect(closing.cards.others.get('T-7')?.schema).toBe('v1');
    expect(closing.cards.cards.has('T-7')).toBe(false);
  });

  it('gives no coefficient next to a card of a newer estimetry, without failing', () => {
    put(...six());
    closing.cards.others.set('T-9', { schema: 'newer', task: 'T-9', version: 4 });
    expect(app.calibration({ type: 'feature' })).toMatchObject({ coefficient: null, skipped: ['T-9'] });
  });

  it('without enough tasks there is no coefficient', () => {
    put(syntheticCard({ id: 'T-1' }), syntheticCard({ id: 'T-2' }));
    expect(app.calibration({ type: 'feature' })).toMatchObject({ coefficient: null, tasks: 2, ratio: { byType: { feature: { n: 2 } } } });
  });
});
