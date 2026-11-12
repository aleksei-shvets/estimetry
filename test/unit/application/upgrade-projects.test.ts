import { beforeEach, describe, expect, it } from 'vitest';
import { createEstimetry, type Estimetry } from '../../../src/application/estimetry.js';
import { installOutdated } from '../../../src/application/shared/install-outdated.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { closingPorts, fakeClosing } from '../../support/closing-fakes.js';
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
import {
  FakeCommitHookInstaller,
  FakeGitExcludes,
  FakeToolAdapter,
  fakeInstallDependencies,
  InMemoryInstallVersions,
  InMemoryProjectConfigFile,
  InMemoryProjectFiles,
  InMemorySharingPreference,
  ListRegistry,
} from '../../support/in-memory-files.js';
import { InMemoryEventJournal, InMemoryProjectRepository, InMemoryTaskRepository } from '../../support/in-memory-repositories.js';

let files: InMemoryProjectFiles;
let projects: InMemoryProjectRepository;
let versions: InMemoryInstallVersions;
let workspace: FakeWorkspaceLocator;
let tool: FakeToolAdapter;
let hook: FakeCommitHookInstaller;

function app(version: string): Estimetry {
  return createEstimetry({
    tasks: new InMemoryTaskRepository(),
    projects,
    workspace,
    authors: new FakeAuthorProvider(),
    taskTypes: new InMemoryTaskTypeCatalog(['feature']),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
    journal: new InMemoryEventJournal(),
    measurement: new FixedMeasurementSettings(),
    estimates: new InMemoryEstimateReader(),
    projectConfig: new InMemoryProjectConfigFile(files),
    install: fakeInstallDependencies(files, {
      tools: new ListRegistry([tool]),
      commitHook: hook,
      sharing: new InMemorySharingPreference(),
      excludes: new FakeGitExcludes(true),
      version,
    }),
    installVersions: versions,
    sessionBindings: new InMemorySessionBindings(),
    taskStatus: new RepositoryTaskStatusReader(new InMemoryTaskRepository()),
    plans: new FakeProjectPlans(),
    ...closingPorts(fakeClosing()),
  });
}

/** `emt init` in a copy, as the version given. */
function init(root: string, version: string, options: { readonly shared?: boolean; readonly main?: string; readonly flow?: string } = {}): void {
  workspace.root = root;
  workspace.main = options.main;
  app(version).project.init({ flow: options.flow ?? 'none', ...(options.shared === undefined ? {} : { shared: options.shared }) });
}

beforeEach(() => {
  files = new InMemoryProjectFiles({ '/work/api/.keep': '', '/work/api-wt/.keep': '', '/work/web/.keep': '', '/work/new/.keep': '' });
  projects = new InMemoryProjectRepository();
  versions = new InMemoryInstallVersions();
  workspace = new FakeWorkspaceLocator('/work/api');
  tool = new FakeToolAdapter();
  hook = new FakeCommitHookInstaller();
  init('/work/api', '0.1.0');
  init('/work/api-wt', '0.1.0', { main: '/work/api' });
  init('/work/web', '0.1.0', { shared: true, flow: 'openspec' });
  workspace.root = '/tmp';
  workspace.main = undefined;
});

describe('emt upgrade', () => {
  it('plans every set-up copy of every project, with its own choices, and writes nothing', () => {
    const before = new Map(files.files);
    const plan = app('0.2.0').project.upgradePlan();
    expect(plan.version).toBe('0.2.0');
    expect(plan.copies.map((copy) => [copy.project, copy.root, copy.installedBy, copy.shared])).toEqual([
      ['api', '/work/api', '0.1.0', false],
      ['api', '/work/api-wt', '0.1.0', false],
      ['web', '/work/web', '0.1.0', true],
    ]);
    expect(plan.copies[0]?.files).toEqual([{ path: '.fake/settings.local.json', status: 'updated' }]);
    expect(plan.copies[2]?.files).toEqual([{ path: '.fake/settings.json', status: 'updated' }]);
    expect(files.files).toEqual(before);
    expect(versions.read('/work/api')).toBe('0.1.0');
  });

  it('installs again with the choices of each copy, records the version, and a following init changes nothing', () => {
    const report = app('0.2.0').project.upgrade();
    expect(report.upgraded.map((copy) => copy.root)).toEqual(['/work/api', '/work/api-wt', '/work/web']);
    expect(files.read('/work/api-wt/.fake/settings.local.json')).toBe('hooks 0.2.0\n');
    expect(files.read('/work/web/.fake/settings.json')).toBe('hooks 0.2.0\n');
    expect(files.read('/work/web/.fake/settings.local.json')).toBeUndefined();
    expect(['/work/api', '/work/api-wt', '/work/web'].map((root) => versions.read(root))).toEqual(['0.2.0', '0.2.0', '0.2.0']);
    // `init` and `upgrade` install one way: after the upgrade, init in a copy has nothing left to do.
    for (const root of ['/work/api', '/work/web']) {
      workspace.root = root;
      const again = app('0.2.0').project.init({});
      expect(again.files.filter((file) => file.status !== 'unchanged'), root).toEqual([]);
    }
  });

  it('skips a copy where estimetry is not set up and a copy that is not on this machine', () => {
    projects.update(ProjectId.parse('api'), (project) => project.withPath('/work/new').withPath('/gone/api'));
    const plan = app('0.2.0').project.upgradePlan();
    expect(plan.skipped).toEqual([
      { project: 'api', root: '/work/new', reason: 'not set up; run `emt init` there' },
      { project: 'api', root: '/gone/api', reason: 'not on this machine' },
    ]);
    app('0.2.0').project.upgrade();
    expect(files.read('/work/new/.fake/settings.local.json')).toBeUndefined();
  });

  it('a copy that cannot be planned is skipped with the reason, the others are upgraded', () => {
    tool.blocked = 'the settings file is broken';
    const report = app('0.2.0').project.upgrade();
    expect(report.upgraded).toEqual([]);
    expect(report.skipped.map((copy) => copy.reason)).toEqual(Array(3).fill('the settings file is broken'));
  });

  it('shows a file outside the copies (a personal skill) under the first copy only', () => {
    const shared = '/home/dev/.fake/skills/emt/SKILL.md';
    const plan = tool.plan.bind(tool);
    tool.plan = (context) => {
      const own = plan(context);
      return { ...own, changes: [...own.changes, { path: shared, content: `skill ${context.version}\n` }] };
    };
    const view = app('0.2.0').project.upgradePlan();
    expect(view.copies.map((copy) => copy.files.some((file) => file.path === shared))).toEqual([true, false, false]);
  });
});

describe('emt upgrade keeps the choices of each copy', () => {
  it('its saved flow, even where another one would be detected, and its commit hook', () => {
    files.write('/work/api/openspec/.keep', '');
    hook.isInstalled = true;
    hook.plans.length = 0;
    app('0.2.0').project.upgrade();
    expect(files.read('/work/api/.estimetry/config.yaml')).toContain('flow: none');
    expect(files.read('/work/web/.estimetry/config.yaml')).toContain('flow: openspec');
    expect(hook.plans).toEqual([true, true, true]);
  });

  it('says why a copy whose settings cannot be read is skipped, instead of calling it not set up', () => {
    projects.update(ProjectId.parse('api'), (project) => project.withPath('/work/new'));
    const state = tool.state.bind(tool);
    tool.state = (root, f) => (root === '/work/new' ? { installed: false, shared: false, unreadable: '.fake/settings.json is not valid JSON' } : state(root, f));
    expect(app('0.2.0').project.upgradePlan().skipped).toEqual([{ project: 'api', root: '/work/new', reason: '.fake/settings.json is not valid JSON' }]);
  });

  it('reports a copy that failed while writing apart from the skipped ones, and upgrades the others', () => {
    const write = files.write.bind(files);
    files.write = (path, content, options) => {
      if (path.startsWith('/work/api-wt/')) {
        throw new Error('permission denied');
      }
      write(path, content, options);
    };
    const report = app('0.2.0').project.upgrade();
    expect(report.upgraded.map((copy) => copy.root)).toEqual(['/work/api', '/work/web']);
    expect(report.failed).toEqual([{ project: 'api', root: '/work/api-wt', reason: 'permission denied' }]);
    expect(report.skipped).toEqual([]);
    expect(versions.read('/work/api-wt')).toBe('0.1.0');
  });

  it('a worktree upgraded leaves nothing for init to do there', () => {
    app('0.2.0').project.upgrade();
    workspace.root = '/work/api-wt';
    workspace.main = '/work/api';
    expect(app('0.2.0').project.init({}).files.filter((file) => file.status !== 'unchanged')).toEqual([]);
  });
});

describe('an outdated install', () => {
  it('is one without a recorded version or with an older one; a newer or unreadable one is not', () => {
    expect(installOutdated(undefined, '0.2.0')).toBe(true);
    expect(installOutdated('0.1.9', '0.2.0')).toBe(true);
    expect(installOutdated('0.2.0', '1.0.0')).toBe(true);
    expect(installOutdated('0.2.0', '0.2.0')).toBe(false);
    expect(installOutdated('0.3.0', '0.2.0')).toBe(false);
    expect(installOutdated('dev', '0.2.0')).toBe(false);
  });
});
