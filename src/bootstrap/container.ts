import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { Estimetry } from '../application/estimetry.js';
import type { HookCall } from '../application/hooks/receive-hook.js';
import type { SharingPreference } from '../application/ports/sharing-preference.js';
import type { InstallDependencies } from '../application/project/init-project.js';
import type { ErrorReporter } from '../application/ports/error-reporter.js';
import type { AuthorProvider } from '../application/ports/author-provider.js';
import type { EventJournal } from '../application/ports/event-journal.js';
import type { IdGenerator } from '../application/ports/id-generator.js';
import type { MeasurementSettings } from '../application/ports/measurement-settings.js';
import type { ProjectPlans } from '../application/ports/project-plans.js';
import type { ProjectRepository } from '../domain/project/project-repository.js';
import { StorageLayout } from '../infrastructure/fs/storage-layout.js';
import { FileErrorReporter } from '../infrastructure/system/file-error-reporter.js';

export interface Environment {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

export function processEnvironment(): Environment {
  return { cwd: process.cwd(), env: process.env, homeDir: homedir() };
}

export interface Container {
  readonly layout: StorageLayout;
  readonly errors: ErrorReporter;
  /** Builds the application on first use; commands that fail early never load storage or git. */
  readonly app: () => Promise<Estimetry>;
  /** The hook receiver alone, without the facade, commander or install code: hooks run on every tool call. */
  readonly hooks: () => Promise<{ receive(call: HookCall): Promise<string | undefined> }>;
}

export interface ContainerOptions {
  /** When the process started (ms since the epoch): the time of every event a hook writes. */
  readonly startedAt?: number;
}

/** Version from package.json, for `--version` and the stamp in generated files. */
export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

/** Claude Code keeps personal skills in `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
function claudeConfigDir(environment: Environment): string {
  const configured = environment.env['CLAUDE_CONFIG_DIR'];
  return configured !== undefined && configured !== '' ? configured : join(environment.homeDir, '.claude');
}

/** Composition root: the only place that knows which implementation backs which port. */
export function createContainer(environment: Environment, options: ContainerOptions = {}): Container {
  const layout = StorageLayout.resolve(environment);
  const errors = new FileErrorReporter(layout.errorsLog);
  let app: Promise<Estimetry> | undefined;
  return {
    layout,
    errors,
    app: () => (app ??= buildApp(layout, environment, errors)),
    hooks: async () => {
      const receiver = await buildHookReceiver(layout, errors, options.startedAt ?? Date.now(), claudeConfigDir(environment));
      return { receive: (call) => receiver.execute(call) };
    },
  };
}

/** Modules of the hook receiver, loaded together: a hook loads nothing of the other commands. */
function hookModules() {
  return Promise.all([
    import('../application/hooks/receive-hook.js'),
    import('../application/hooks/session-task.js'),
    import('../application/hooks/checkpoints.js'),
    import('../application/hooks/flow-plans.js'),
    import('../application/hooks/change-completions.js'),
    import('../application/hooks/commit-records.js'),
    import('../application/hooks/recent-sessions.js'),
    import('../application/hooks/checkpoint-snapshot.js'),
    import('../application/hooks/progress-log.js'),
    import('../application/shared/change-archives.js'),
    import('../application/shared/event-meta-source.js'),
    import('../integrations/tools/hook-adapters.js'),
    import('../integrations/tools/claude-code/hook-translation.js'),
    import('../integrations/tools/git/git-hooks.js'),
    import('../integrations/flows/registry.js'),
    import('../integrations/flows/openspec/openspec-flow.js'),
    import('../integrations/flows/none/none-flow.js'),
    import('../infrastructure/fs/fs-project-locator.js'),
    import('../infrastructure/fs/node-project-files.js'),
    import('../infrastructure/persistence/yaml-session-store.js'),
    import('../infrastructure/persistence/yaml-progress-state.js'),
    import('../infrastructure/persistence/file-close-proposals.js'),
    import('../infrastructure/persistence/file-project-repository.js'),
    import('../infrastructure/persistence/file-task-status-reader.js'),
    import('../infrastructure/persistence/jsonl-event-journal.js'),
    import('../infrastructure/persistence/yaml-config-store.js'),
    import('../infrastructure/persistence/yaml-project-config-file.js'),
    import('../infrastructure/git/fs-git-head.js'),
    import('../infrastructure/git/git-snapshots.js'),
    import('../infrastructure/system/random-id-generator.js'),
    import('../domain/shared/timestamp.js'),
  ]);
}

/**
 * Only what a hook needs. The author comes from config.yaml alone: detecting it
 * would run git, and init has written the profile already.
 */
async function buildHookReceiver(layout: StorageLayout, errors: ErrorReporter, startedAt: number, claudeConfig: string) {
  const [
    { ReceiveHook },
    { SessionTask },
    { Checkpoints },
    { FlowProjectPlans },
    { ChangeCompletions },
    { CommitRecords, CommitTask },
    { RecentSessions },
    { CheckpointSnapshot },
    { ProgressLog },
    { ChangeArchives },
    { EventMetaSource },
    { HookAdapterRegistry },
    { claudeCodeHooks },
    { gitHooks },
    { FlowRegistry },
    { openSpecFlow },
    { noneFlow },
    { FsProjectLocator },
    { NodeProjectFiles },
    { YamlSessionStore, YamlCheckpointState },
    { YamlProgressState },
    { FileCloseProposals },
    { FileProjectRepository },
    { FileTaskStatusReader },
    { JsonlEventJournal },
    { YamlConfigStore },
    { YamlProjectConfigFile },
    { FsGitHead },
    { GitSnapshotsCli },
    { RandomIdGenerator },
    { Timestamp },
  ] = await hookModules();
  const config = new YamlConfigStore(layout, () => {
    throw new Error(`no author profile in ${layout.configFile}; run estimetry init`);
  });
  const journal = new JsonlEventJournal(layout);
  const ids = new RandomIdGenerator();
  const tasks = new FileTaskStatusReader(layout);
  const bindings = new YamlSessionStore(layout);
  const checkpointState = new YamlCheckpointState(layout);
  const git = new GitSnapshotsCli();
  const started = Timestamp.fromMillis(Math.round(startedAt));
  const flows = new FlowRegistry().register(openSpecFlow).register(noneFlow);
  const files = new NodeProjectFiles();
  const projects = new FileProjectRepository(layout);
  const plans = new FlowProjectPlans(new YamlProjectConfigFile(), flows, files, projects);
  const proposals = new FileCloseProposals(layout);
  const clock = { now: () => started };
  const meta = new EventMetaSource(clock, ids, config);
  const locator = new FsProjectLocator(layout);
  const recent = new RecentSessions(checkpointState, config);
  return new ReceiveHook({
    adapters: new HookAdapterRegistry().register(claudeCodeHooks).register(gitHooks),
    locator,
    sessionTask: new SessionTask(bindings, tasks, journal, ids, config),
    checkpoints: new Checkpoints(checkpointState, journal, new CheckpointSnapshot(plans, new FsGitHead(), git), config, errors, meta),
    completions: new ChangeCompletions(new ChangeArchives(plans, files), new ProgressLog(new YamlProgressState(layout), journal), tasks, meta, errors, proposals),
    proposals,
    // Only a pending proposal to close the task needs the plan of the task.
    planOf: () => hookPlanOf(layout, plans, projects),
    journal,
    tasks,
    bindings,
    commits: new CommitRecords(locator, git, new CommitTask(bindings, tasks, recent), journal, meta),
    recent,
    // Only the session start needs the fact, and only it loads the task repository and the calculator.
    facts: () => hookFacts(layout, journal, config, plans),
    clock,
    ids,
    authors: config,
    // Only the session end parses a log, and only it loads the reader.
    logs: () => hookLogs({ layout, claudeConfig, journal, ids, config, errors }),
  });
}

/** The plan of a task for the text of a pending proposal to close it: percent done and unfinished groups. */
async function hookPlanOf(layout: StorageLayout, plans: ProjectPlans, projects: ProjectRepository) {
  const [{ PlanSnapshots }, { SnapshotTaskReader }, { FsGitHead: Head }, { TaskId }] = await Promise.all([
    import('../application/task/plan-snapshots.js'),
    import('../infrastructure/persistence/snapshot-task-reader.js'),
    import('../infrastructure/git/fs-git-head.js'),
    import('../domain/task/task-id.js'),
  ]);
  const snapshots = new PlanSnapshots(plans, new Head(), projects);
  const reader = new SnapshotTaskReader(layout);
  return {
    of: (task: string, near: string) => {
      const found = reader.find(TaskId.parse(task));
      if (found === undefined) {
        return { unfinished: [] };
      }
      const plan = snapshots.closing(found, { near });
      return { ...(plan.done === undefined ? {} : { done: plan.done }), unfinished: plan.unfinishedGroups };
    },
  };
}

/** The fact of a task for the context of a session start. */
async function hookFacts(layout: StorageLayout, journal: EventJournal, settings: MeasurementSettings, plans: ProjectPlans) {
  const [{ MeasuredTaskFacts }, { TaskMeasurement }, { TaskPlanProgress }, { SnapshotTaskReader }, { SystemClock }] = await Promise.all([
    import('../application/hooks/task-facts.js'),
    import('../application/task/task-measurement.js'),
    import('../application/task/task-plan-progress.js'),
    import('../infrastructure/persistence/snapshot-task-reader.js'),
    import('../infrastructure/system/system-clock.js'),
  ]);
  return new MeasuredTaskFacts(new SnapshotTaskReader(layout), new TaskMeasurement(journal, settings, new SystemClock()), new TaskPlanProgress(plans, journal));
}

/** The importer of session logs for a session end. */
async function hookLogs(c: {
  readonly layout: StorageLayout;
  readonly claudeConfig: string;
  readonly journal: EventJournal;
  readonly ids: IdGenerator;
  readonly config: AuthorProvider;
  readonly errors: ErrorReporter;
}) {
  const [{ ImportSessionLogs }, { SessionLogReaderRegistry }, { ClaudeCodeLogs }, { YamlLogImportState }, { SystemClock }] = await Promise.all([
    import('../application/task/import-session-logs.js'),
    import('../integrations/tools/session-log-readers.js'),
    import('../integrations/tools/claude-code/importer/claude-code-logs.js'),
    import('../infrastructure/persistence/yaml-log-import-state.js'),
    import('../infrastructure/system/system-clock.js'),
  ]);
  return new ImportSessionLogs({
    readers: new SessionLogReaderRegistry().register(new ClaudeCodeLogs(c.claudeConfig)),
    state: new YamlLogImportState(c.layout),
    journal: c.journal,
    ids: c.ids,
    clock: new SystemClock(),
    authors: c.config,
    errors: c.errors,
  });
}

async function toolRegistry(environment: Environment) {
  const [{ ToolAdapterRegistry }, { ClaudeCodeAdapter }] = await Promise.all([
    import('../integrations/tools/registry.js'),
    import('../integrations/tools/claude-code/claude-code-adapter.js'),
  ]);
  return new ToolAdapterRegistry().register(new ClaudeCodeAdapter(claudeConfigDir(environment)));
}

async function installDependencies(environment: Environment, sharing: SharingPreference): Promise<InstallDependencies> {
  const [
    tools,
    { FlowRegistry },
    { openSpecFlow },
    { noneFlow },
    { StackDetectorRegistry },
    { nodeDetector },
    { dartDetector },
    { mavenDetector, gradleDetector },
    { pythonDetector },
    { goDetector },
    { composeDetector },
    { NodeProjectFiles },
    { GitCommitHookInstaller },
    { GitExcludesFile },
    { PathCommandLocator },
  ] = await Promise.all([
    toolRegistry(environment),
    import('../integrations/flows/registry.js'),
    import('../integrations/flows/openspec/openspec-flow.js'),
    import('../integrations/flows/none/none-flow.js'),
    import('../integrations/stack/registry.js'),
    import('../integrations/stack/node-detector.js'),
    import('../integrations/stack/dart-detector.js'),
    import('../integrations/stack/jvm-detector.js'),
    import('../integrations/stack/python-detector.js'),
    import('../integrations/stack/go-detector.js'),
    import('../integrations/stack/compose-detector.js'),
    import('../infrastructure/fs/node-project-files.js'),
    import('../infrastructure/git/git-commit-hook-installer.js'),
    import('../infrastructure/git/git-excludes-file.js'),
    import('../infrastructure/system/path-command-locator.js'),
  ]);
  return {
    files: new NodeProjectFiles(),
    tools,
    // The last flow is the fallback when none is detected.
    flows: new FlowRegistry().register(openSpecFlow).register(noneFlow),
    detectors: [nodeDetector, dartDetector, mavenDetector, gradleDetector, pythonDetector, goDetector, composeDetector].reduce(
      (registry, detector) => registry.register(detector),
      new StackDetectorRegistry(),
    ),
    commitHook: new GitCommitHookInstaller(),
    sharing,
    commands: new PathCommandLocator(environment.env),
    excludes: new GitExcludesFile(environment.env, environment.homeDir),
    version: packageVersion(),
  };
}

async function buildApp(layout: StorageLayout, environment: Environment, errors: ErrorReporter): Promise<Estimetry> {
  const cwd = environment.cwd;
  const [
    { createEstimetry },
    { GitCli },
    { FileTaskRepository },
    { FileProjectRepository },
    { JsonlEventJournal },
    { YamlEstimateReader },
    { YamlConfigStore },
    { YamlProjectConfigFile },
    { SystemClock },
    { RandomIdGenerator },
    { YamlSessionStore },
    { FileTaskStatusReader },
    { FlowProjectPlans },
    { YamlCardStore },
    { JsonCalibrationStore },
    { FileCloseProposals },
    { GitCodeMeasurer },
    { FsGitHead },
    { SessionLogReaderRegistry },
    { ClaudeCodeLogs },
    { YamlLogImportState },
  ] = await Promise.all([
    import('../application/estimetry.js'),
    import('../infrastructure/git/git-cli.js'),
    import('../infrastructure/persistence/file-task-repository.js'),
    import('../infrastructure/persistence/file-project-repository.js'),
    import('../infrastructure/persistence/jsonl-event-journal.js'),
    import('../infrastructure/persistence/yaml-estimate-reader.js'),
    import('../infrastructure/persistence/yaml-config-store.js'),
    import('../infrastructure/persistence/yaml-project-config-file.js'),
    import('../infrastructure/system/system-clock.js'),
    import('../infrastructure/system/random-id-generator.js'),
    import('../infrastructure/persistence/yaml-session-store.js'),
    import('../infrastructure/persistence/file-task-status-reader.js'),
    import('../application/hooks/flow-plans.js'),
    import('../infrastructure/persistence/yaml-card-store.js'),
    import('../infrastructure/persistence/json-calibration-store.js'),
    import('../infrastructure/persistence/file-close-proposals.js'),
    import('../infrastructure/git/git-code-measurer.js'),
    import('../infrastructure/git/fs-git-head.js'),
    import('../integrations/tools/session-log-readers.js'),
    import('../integrations/tools/claude-code/importer/claude-code-logs.js'),
    import('../infrastructure/persistence/yaml-log-import-state.js'),
  ]);
  const git = new GitCli(cwd);
  const config = new YamlConfigStore(layout, () => git.userEmail() ?? userInfo().username);
  const projects = new FileProjectRepository(layout);
  const projectConfig = new YamlProjectConfigFile();
  const install = await installDependencies(environment, config);
  return createEstimetry({
    tasks: new FileTaskRepository(layout),
    projects,
    workspace: git,
    authors: config,
    taskTypes: config,
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
    journal: new JsonlEventJournal(layout),
    measurement: config,
    estimates: new YamlEstimateReader(cwd),
    projectConfig,
    install,
    plans: new FlowProjectPlans(projectConfig, install.flows, install.files, projects),
    sessionBindings: new YamlSessionStore(layout),
    taskStatus: new FileTaskStatusReader(layout),
    cards: new YamlCardStore(layout),
    calibration: new JsonCalibrationStore(layout, () => new Date().toISOString()),
    calibrationSettings: config,
    proposals: new FileCloseProposals(layout),
    codeMeasurer: new GitCodeMeasurer(),
    gitHead: new FsGitHead(),
    errors,
    logReaders: new SessionLogReaderRegistry().register(new ClaudeCodeLogs(claudeConfigDir(environment))),
    logImportState: new YamlLogImportState(layout),
  });
}
