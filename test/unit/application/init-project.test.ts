import { beforeEach, describe, expect, it } from 'vitest';
import { closingPorts, fakeClosing } from '../../support/closing-fakes.js';
import { createEstimetry, type Estimetry } from '../../../src/application/estimetry.js';
import { InstallBlocked } from '../../../src/application/contracts/install-blocked.js';
import type { InstallDependencies } from '../../../src/application/project/init-project.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
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
  FakeCommandLocator,
  FakeCommitHookInstaller,
  FakeGitExcludes,
  FakeToolAdapter,
  fakeInstallDependencies,
  InMemoryProjectConfigFile,
  InMemoryProjectFiles,
  InMemorySharingPreference,
  ListRegistry,
} from '../../support/in-memory-files.js';
import { InMemoryEventJournal, InMemoryProjectRepository, InMemoryTaskRepository } from '../../support/in-memory-repositories.js';
import { FakeProjectPlans, InMemorySessionBindings, RepositoryTaskStatusReader } from '../../support/hook-fakes.js';

const ROOT = '/work/api';
const REPO = 'c'.repeat(40);

let files: InMemoryProjectFiles;
let projects: InMemoryProjectRepository;
let tool: FakeToolAdapter;
let hook: FakeCommitHookInstaller;
let sharing: InMemorySharingPreference;
let excludes: FakeGitExcludes;
let workspace: FakeWorkspaceLocator;
let app: Estimetry;

function build(overrides: Partial<InstallDependencies> = {}): void {
  app = createEstimetry({
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
    install: fakeInstallDependencies(files, { tools: new ListRegistry([tool]), commitHook: hook, sharing, excludes, ...overrides }),
    sessionBindings: new InMemorySessionBindings(), taskStatus: new RepositoryTaskStatusReader(new InMemoryTaskRepository()),
    plans: new FakeProjectPlans(),
    ...closingPorts(fakeClosing()),
  });
}

beforeEach(() => {
  files = new InMemoryProjectFiles({ [`${ROOT}/go.mod`]: 'module api\n' });
  projects = new InMemoryProjectRepository();
  tool = new FakeToolAdapter();
  hook = new FakeCommitHookInstaller();
  sharing = new InMemorySharingPreference();
  excludes = new FakeGitExcludes(true);
  workspace = new FakeWorkspaceLocator(ROOT, REPO);
  build();
});

describe('init', () => {
  it('installs with defaults: detected flow, no shared install, no git hook', () => {
    files.write(`${ROOT}/openspec/project.md`, '# x\n');
    const report = app.project.init({});
    expect(report).toMatchObject({ project: 'api', flow: 'openspec', tools: ['fake-tool'], stack: ['go'], share: 'none' });
    expect(report.files).toEqual([
      { path: '.fake/settings.local.json', status: 'created' },
      { path: '.fake/settings.json', status: 'unchanged' },
      { path: '.estimetry/config.yaml', status: 'created' },
    ]);
    expect(files.read(`${ROOT}/.estimetry/config.yaml`)).toBe('schemaVersion: 1\nproject: api\nflow: openspec\n');
    expect(projects.findById(projects.findByPath(ROOT)!.id)?.toSnapshot()).toMatchObject({ stack: ['go'], fingerprint: REPO });
    expect(hook.plans).toEqual([false]);
  });

  it('is idempotent', () => {
    app.project.init({});
    const second = app.project.init({});
    expect(second.files.every((file) => file.status === 'unchanged')).toBe(true);
  });

  it('takes the defaults of a repeated run from what is installed, not from the project config', () => {
    app.project.init({ shared: true, trackCommits: true });
    hook.isInstalled = true;
    expect(files.read(`${ROOT}/.estimetry/config.yaml`)).not.toMatch(/shared|track/i);
    expect(app.project.choices().defaults).toMatchObject({ shared: true, trackCommits: true, tools: ['fake-tool'] });
    app.project.init({});
    expect(files.read(`${ROOT}/.fake/settings.json`)).toBeDefined();
    expect(hook.plans.at(-1)).toBe(true);
  });

  it('a colleague with the same project config gets the personal install', () => {
    files.write(`${ROOT}/.estimetry/config.yaml`, 'project: api\nflow: none\nnote: shared\n');
    const report = app.project.init({});
    expect(report.flow).toBe('none');
    expect(files.read(`${ROOT}/.fake/settings.local.json`)).toBeDefined();
    expect(files.read(`${ROOT}/.fake/settings.json`)).toBeUndefined();
    expect(files.read(`${ROOT}/.estimetry/config.yaml`)).toContain('note: shared');
  });

  it('rejects unknown choices before touching anything', () => {
    expect(() => app.project.init({ tools: ['cursor'] })).toThrow(/expected one of: fake-tool/);
    expect(() => app.project.init({ flow: 'spec-kit' })).toThrow(InvalidValue);
    expect(() => app.project.init({ share: 'everyone' })).toThrow(/none, calibration, cards/);
    expect(files.writes).toEqual([]);
    expect([...projects.ids()]).toEqual([]);
  });

  it('passes on what the chosen flow still needs', () => {
    expect(app.project.init({ flow: 'openspec' }).warnings).toContain('run `openspec init`');
    expect(app.project.init({ flow: 'none' }).warnings).not.toContain('run `openspec init`');
  });

  it('accepts an alias of the tool', () => {
    expect(app.project.init({ tools: ['fake'] }).tools).toEqual(['fake-tool']);
  });

  it('a blocked installer leaves the files and the registry untouched', () => {
    tool.blocked = '.fake/settings.local.json: not valid JSON';
    expect(() => app.project.init({ trackCommits: true })).toThrow(InstallBlocked);
    expect(files.writes).toEqual([]);
    expect([...projects.ids()]).toEqual([]);
  });

  it('saves the share mode and uses it as the default next time', () => {
    app.project.init({ share: 'calibration' });
    expect(sharing.saved).toBe('calibration');
    expect(app.project.choices().defaults.share).toBe('calibration');
  });

  it('warns about a broken manifest, a missing estimetry on PATH and an id taken by another repository', () => {
    build({ commands: new FakeCommandLocator([]) });
    files.write(`${ROOT}/go.mod`, 'broken');
    projects.addIfAbsent(
      // Same id, other repository.
      (() => {
        const other = new FakeWorkspaceLocator('/elsewhere/api', 'd'.repeat(40));
        const resolve = createEstimetry({
          tasks: new InMemoryTaskRepository(), projects, workspace: other, authors: new FakeAuthorProvider(),
          taskTypes: new InMemoryTaskTypeCatalog(['feature']), clock: new FixedClock(), ids: new SequentialIdGenerator(),
          journal: new InMemoryEventJournal(), measurement: new FixedMeasurementSettings(), estimates: new InMemoryEstimateReader(),
          projectConfig: new InMemoryProjectConfigFile(files), install: fakeInstallDependencies(files),
          sessionBindings: new InMemorySessionBindings(), taskStatus: new RepositoryTaskStatusReader(new InMemoryTaskRepository()),
          plans: new FakeProjectPlans(),
          ...closingPorts(fakeClosing()),
        });
        resolve.tasks.create({ title: 'x' });
        return projects.findByPath('/elsewhere/api')!;
      })(),
    );
    files.write(`${ROOT}/.estimetry/config.yaml`, 'project: api\n');
    const report = app.project.init({});
    expect(report.project).toBe('api-2');
    expect(report.warnings.join('\n')).toMatch(/go\.mod: not a go\.mod/);
    expect(report.warnings.join('\n')).toMatch(/not on PATH/);
    expect(report.warnings.join('\n')).toMatch(/registered as api-2/);
    expect(files.read(`${ROOT}/.estimetry/config.yaml`)).toContain('project: api');
  });

  it('asks to exclude personal files git does not ignore, and only warns without consent', () => {
    excludes.ignored = false;
    expect(app.project.choices().unignoredPersonalFiles).toEqual(['.fake/settings.local.json']);
    const warned = app.project.init({});
    expect(warned.warnings.join('\n')).toContain(`echo '**/.fake/settings.local.json' >> ${excludes.file}`);
    expect(files.read(excludes.file)).toBeUndefined();

    files.write(excludes.file, '*.swp');
    const excluded = app.project.init({ excludePersonalFiles: true });
    expect(files.read(excludes.file)).toBe('*.swp\n**/.fake/settings.local.json\n');
    expect(excluded.files).toContainEqual({ path: excludes.file, status: 'updated' });
  });

  it('does not ask about personal files for a shared install', () => {
    excludes.ignored = false;
    const report = app.project.init({ shared: true });
    expect(report.warnings.join('\n')).not.toContain('not ignored');
  });
});
