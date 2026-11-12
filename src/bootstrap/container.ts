import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { Estimetry } from '../application/estimetry.js';
import type { HookCall } from '../application/hooks/hook-call.js';
import type { SharingPreference } from '../application/ports/sharing-preference.js';
import type { InstallDependencies } from '../application/project/install-dependencies.js';
import type { ErrorReporter } from '../application/ports/error-reporter.js';
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

import { packageVersion } from './package-version.js';

export { packageVersion };

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
      const { buildHookReceiver } = await import('./hook-receiver.js');
      const receiver = buildHookReceiver(layout, errors, options.startedAt ?? Date.now(), claudeConfigDir(environment));
      return { receive: (call) => receiver.execute(call) };
    },
  };
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
    registries: {
      tools,
      // The last flow is the fallback when none is detected.
      flows: new FlowRegistry().register(openSpecFlow).register(noneFlow),
      detectors: [nodeDetector, dartDetector, mavenDetector, gradleDetector, pythonDetector, goDetector, composeDetector].reduce(
        (registry, detector) => registry.register(detector),
        new StackDetectorRegistry(),
      ),
    },
    git: { commitHook: new GitCommitHookInstaller(), excludes: new GitExcludesFile(environment.env, environment.homeDir) },
    sharing,
    commands: new PathCommandLocator(environment.env),
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
    { YamlInstallVersions },
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
    import('../infrastructure/persistence/yaml-install-versions.js'),
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
    installVersions: new YamlInstallVersions(layout),
    plans: new FlowProjectPlans(projectConfig, install.registries.flows, install.files, projects),
    sessionBindings: new YamlSessionStore(layout),
    taskStatus: new FileTaskStatusReader(layout),
    calibrationSettings: config,
    errors,
    ...(await closingPorts(layout, environment)),
  });
}

/** What closing a task needs besides the task: cards, calibration, proposals, the code volume, `HEAD` and the session logs. */
async function closingPorts(layout: StorageLayout, environment: Environment) {
  const [
    { YamlCardStore },
    { JsonCalibrationStore },
    { FileCloseProposals },
    { GitCodeMeasurer },
    { FsGitHead },
    { SessionLogReaderRegistry },
    { ClaudeCodeLogs },
    { YamlLogImportState },
  ] = await Promise.all([
    import('../infrastructure/persistence/yaml-card-store.js'),
    import('../infrastructure/persistence/json-calibration-store.js'),
    import('../infrastructure/persistence/file-close-proposals.js'),
    import('../infrastructure/git/git-code-measurer.js'),
    import('../infrastructure/git/fs-git-head.js'),
    import('../integrations/tools/session-log-readers.js'),
    import('../integrations/tools/claude-code/importer/claude-code-logs.js'),
    import('../infrastructure/persistence/yaml-log-import-state.js'),
  ]);
  return {
    cards: new YamlCardStore(layout),
    calibration: new JsonCalibrationStore(layout, () => new Date().toISOString()),
    proposals: new FileCloseProposals(layout),
    codeMeasurer: new GitCodeMeasurer(),
    gitHead: new FsGitHead(),
    logReaders: new SessionLogReaderRegistry().register(new ClaudeCodeLogs(claudeConfigDir(environment))),
    logImportState: new YamlLogImportState(layout),
  };
}
