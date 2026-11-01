import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { Estimetry } from '../application/estimetry.js';
import type { HookCall } from '../application/hooks/receive-hook.js';
import type { SharingPreference } from '../application/ports/sharing-preference.js';
import type { InstallDependencies } from '../application/project/init-project.js';
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
    app: () => (app ??= buildApp(layout, environment)),
    hooks: async () => {
      const receiver = await buildHookReceiver(layout, errors, options.startedAt ?? Date.now());
      return { receive: (call) => receiver.execute(call) };
    },
  };
}

/**
 * Only what a hook needs. The author comes from config.yaml alone: detecting it
 * would run git, and init has written the profile already.
 */
async function buildHookReceiver(layout: StorageLayout, errors: ErrorReporter, startedAt: number) {
  const [
    { ReceiveHook },
    { SessionTask },
    { Checkpoints },
    { FlowProjectPlans },
    { ChangeCompletions },
    { HookAdapterRegistry },
    { claudeCodeHooks },
    { FlowRegistry },
    { openSpecFlow },
    { noneFlow },
    { FsProjectLocator },
    { NodeProjectFiles },
    { YamlSessionStore, YamlCheckpointState },
    { YamlProgressState },
    { FileProjectRepository },
    { FileTaskStatusReader },
    { JsonlEventJournal },
    { YamlConfigStore },
    { YamlProjectConfigFile },
    { FsGitHead },
    { GitSnapshotsCli },
    { RandomIdGenerator },
    { Timestamp },
  ] = await Promise.all([
    import('../application/hooks/receive-hook.js'),
    import('../application/hooks/session-task.js'),
    import('../application/hooks/checkpoints.js'),
    import('../application/hooks/flow-plans.js'),
    import('../application/hooks/change-completions.js'),
    import('../integrations/tools/hook-adapters.js'),
    import('../integrations/tools/claude-code/hook-translation.js'),
    import('../integrations/flows/registry.js'),
    import('../integrations/flows/openspec/openspec-flow.js'),
    import('../integrations/flows/none/none-flow.js'),
    import('../infrastructure/fs/fs-project-locator.js'),
    import('../infrastructure/fs/node-project-files.js'),
    import('../infrastructure/persistence/yaml-session-store.js'),
    import('../infrastructure/persistence/yaml-progress-state.js'),
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
  const plans = new FlowProjectPlans(new YamlProjectConfigFile(), flows, files, new FileProjectRepository(layout));
  return new ReceiveHook({
    adapters: new HookAdapterRegistry().register(claudeCodeHooks),
    locator: new FsProjectLocator(layout),
    sessionTask: new SessionTask(bindings, tasks, journal, ids, config),
    checkpoints: new Checkpoints(
      checkpointState,
      journal,
      plans,
      new FsGitHead(),
      git,
      config,
      errors,
      ids,
      config,
    ),
    completions: new ChangeCompletions(plans, files, new YamlProgressState(layout), journal, tasks, ids, config, errors),
    journal,
    tasks,
    bindings,
    checkpointState,
    git,
    settings: config,
    // Only the session start needs the fact, and only it loads the task repository and the calculator.
    facts: async () => {
      const [{ MeasuredTaskFacts }, { TaskMeasurement }, { TaskPlanProgress }, { SnapshotTaskReader }, { SystemClock }] =
        await Promise.all([
          import('../application/hooks/task-facts.js'),
          import('../application/task/task-measurement.js'),
          import('../application/task/task-plan-progress.js'),
          import('../infrastructure/persistence/snapshot-task-reader.js'),
          import('../infrastructure/system/system-clock.js'),
        ]);
      return new MeasuredTaskFacts(
        new SnapshotTaskReader(layout),
        new TaskMeasurement(journal, config, new SystemClock()),
        new TaskPlanProgress(plans, journal),
      );
    },
    clock: { now: () => started },
    ids,
    authors: config,
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

async function buildApp(layout: StorageLayout, environment: Environment): Promise<Estimetry> {
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
    workspaceDir: cwd,
    sessions: { bindings: new YamlSessionStore(layout), tasks: new FileTaskStatusReader(layout) },
  });
}
