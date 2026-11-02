import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClosing } from '../../support/closing-fakes.js';
import { createEstimetry, type Estimetry } from '../../../src/application/estimetry.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { Project } from '../../../src/domain/project/project.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { AmbiguousTask, ConcurrencyConflict, InvalidTransition, TaskNotFound, UnknownTaskType } from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import {
  FakeAuthorProvider,
  FakeWorkspaceLocator,
  FixedClock,
  FixedMeasurementSettings,
  InMemoryEstimateReader,
  InMemoryTaskTypeCatalog,
  SequentialIdGenerator,
} from '../../support/fakes.js';
import { InMemoryEventJournal, InMemoryProjectRepository, InMemoryTaskRepository } from '../../support/in-memory-repositories.js';
import { fakeInstallDependencies, InMemoryProjectConfigFile, InMemoryProjectFiles } from '../../support/in-memory-files.js';
import { FakeProjectPlans, InMemorySessionBindings, RepositoryTaskStatusReader } from '../../support/hook-fakes.js';

let tasks: InMemoryTaskRepository;
let projects: InMemoryProjectRepository;
let workspace: FakeWorkspaceLocator;
let authors: FakeAuthorProvider;
let app: Estimetry;

const T = (id: string) => TaskId.parse(id);

let projectFiles: InMemoryProjectFiles;

beforeEach(() => {
  projectFiles = new InMemoryProjectFiles();
  tasks = new InMemoryTaskRepository();
  projects = new InMemoryProjectRepository();
  workspace = new FakeWorkspaceLocator('/work/api');
  authors = new FakeAuthorProvider();
  app = createEstimetry({
    tasks,
    projects,
    workspace,
    authors,
    taskTypes: new InMemoryTaskTypeCatalog([...['feature', 'integration'], 'spike']),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
    journal: new InMemoryEventJournal(),
    measurement: new FixedMeasurementSettings(),
    estimates: new InMemoryEstimateReader(),
    projectConfig: new InMemoryProjectConfigFile(projectFiles),
    install: fakeInstallDependencies(projectFiles),
    sessions: { bindings: new InMemorySessionBindings(), tasks: new RepositoryTaskStatusReader(tasks) },
    plans: new FakeProjectPlans(),
    closing: fakeClosing(),
  });
});

describe('project resolution', () => {
  it('registers the current project on the first write', () => {
    app.createTask({ title: 'X' });
    expect(projects.projects.map((p) => p.toSnapshot())).toMatchObject([
      { id: 'api', name: 'api', paths: ['/work/api'], stack: [], author: 'dev@example.com' },
    ]);
  });

  it('adds a numeric suffix when the name is taken by another path', () => {
    projects.addIfAbsent(
      Project.register({ id: ProjectId.parse('api'), name: 'api', path: '/old/api' }, Author.of('a'), Timestamp.fromMillis(0)),
    );
    app.createTask({ title: 'X' });
    expect(projects.findByPath('/work/api')?.id.value).toBe('api-2');
  });

  it('does not register anything on reads', () => {
    expect(app.listTasks({})).toEqual([]);
    expect(projects.projects).toEqual([]);
    expect(authors.calls).toBe(0);
  });
});

describe('createTask', () => {
  it('creates a new task with defaults', () => {
    const view = app.createTask({ title: 'Login screen' });
    expect(view).toMatchObject({ id: 'T-1', title: 'Login screen', type: 'feature', status: 'new', estimated: false, projects: ['api'] });
    expect(app.createTask({ title: 'Second' }).id).toBe('T-2');
  });

  it('accepts types from the catalog, including custom ones', () => {
    expect(app.createTask({ title: 'X', type: 'spike', ticket: 'PAY-42' })).toMatchObject({ type: 'spike', ticket: 'PAY-42' });
  });

  it('rejects an unknown type before touching storage', () => {
    expect(() => app.createTask({ title: 'X', type: 'banana' })).toThrow(UnknownTaskType);
    expect(projects.projects).toEqual([]);
    expect(app.createTask({ title: 'Y' }).id).toBe('T-1');
  });

  it('rejects an empty title', () => {
    expect(() => app.createTask({ title: ' ' })).toThrow(InvalidValue);
  });
});

describe('startTask', () => {
  it('starts the given task and marks it unestimated', () => {
    app.createTask({ title: 'X' });
    expect(app.startTask({ task: T('T-1') })).toMatchObject({ status: 'in-progress', estimated: false });
    expect(tasks.journals.get('T-1')?.map((e) => e.type)).toEqual(['task.created', 'task.started']);
  });

  it('picks the only startable task of the current project', () => {
    app.createTask({ title: 'X' });
    workspace.root = '/work/web';
    app.createTask({ title: 'Other project' });
    workspace.root = '/work/api';
    expect(app.startTask({}).id).toBe('T-1');
  });

  it('refuses to guess between several tasks', () => {
    app.createTask({ title: 'A' });
    app.createTask({ title: 'B' });
    const error = (() => {
      try {
        app.startTask({});
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(AmbiguousTask);
    expect((error as AmbiguousTask).candidates).toEqual(['T-1', 'T-2']);
    expect(tasks.journals.get('T-1')).toHaveLength(1);
  });

  it('reports when there is nothing to start', () => {
    expect(() => app.startTask({})).toThrow(AmbiguousTask);
  });

  it('refuses to start twice and writes nothing', () => {
    app.createTask({ title: 'X' });
    app.startTask({ task: T('T-1') });
    expect(() => app.startTask({ task: T('T-1') })).toThrow(InvalidTransition);
    expect(tasks.journals.get('T-1')).toHaveLength(2);
  });

  it('fails on an unknown task', () => {
    expect(() => app.startTask({ task: T('T-999') })).toThrow(TaskNotFound);
  });

  it('retries once when another process saved the task concurrently', () => {
    app.createTask({ title: 'X' });
    tasks.beforeSave = () => {
      const other = tasks.get(T('T-1'));
      other.attach(ProjectId.parse('web'), { id: 'concurrent', at: Timestamp.fromMillis(0), author: Author.of('a') });
      tasks.save(other);
    };
    expect(app.startTask({ task: T('T-1') })).toMatchObject({ status: 'in-progress', projects: ['api', 'web'] });
  });

  it('gives up after a second conflict', () => {
    app.createTask({ title: 'X' });
    const interfere = () => {
      const other = tasks.get(T('T-1'));
      other.attach(ProjectId.parse(`p-${Math.random().toString(36).slice(2, 8)}`), {
        id: Math.random().toString(),
        at: Timestamp.fromMillis(0),
        author: Author.of('a'),
      });
      tasks.save(other);
    };
    tasks.beforeSave = () => {
      interfere();
      tasks.beforeSave = interfere;
    };
    expect(() => app.startTask({ task: T('T-1') })).toThrow(ConcurrencyConflict);
  });
});

describe('attachTask', () => {
  it('connects the task to a second project once', () => {
    app.createTask({ title: 'X' });
    workspace.root = '/work/web';
    expect(app.attachTask({ task: T('T-1') })).toMatchObject({ attached: true, project: 'web', task: { projects: ['api', 'web'] } });
    expect(app.attachTask({ task: T('T-1') })).toMatchObject({ attached: false });
    expect(tasks.journals.get('T-1')?.map((e) => e.type)).toEqual(['task.created', 'task.attached']);
  });

  it('does not register the project for an unknown task', () => {
    expect(() => app.attachTask({ task: T('T-7') })).toThrow(TaskNotFound);
    expect(projects.projects).toEqual([]);
  });
});

describe('listTasks and showTask', () => {
  it('lists tasks of the current project or of all projects', () => {
    app.createTask({ title: 'A' });
    app.createTask({ title: 'B' });
    workspace.root = '/work/web';
    app.createTask({ title: 'C' });
    workspace.root = '/work/api';
    expect(app.listTasks({}).map((t) => t.id)).toEqual(['T-1', 'T-2']);
    expect(app.listTasks({ all: true }).map((t) => t.id)).toEqual(['T-1', 'T-2', 'T-3']);
    expect(app.showTask({ task: T('T-3') })).toMatchObject({ title: 'C', projects: ['web'] });
  });
});
