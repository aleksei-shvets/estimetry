import { homedir, userInfo } from 'node:os';
import type { Estimetry } from '../application/estimetry.js';
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
}

/** Composition root: the only place that knows which implementation backs which port. */
export function createContainer(environment: Environment): Container {
  const layout = StorageLayout.resolve(environment);
  const errors = new FileErrorReporter(layout.errorsLog);
  let app: Promise<Estimetry> | undefined;
  return {
    layout,
    errors,
    app: () => (app ??= buildApp(layout, environment.cwd)),
  };
}

async function buildApp(layout: StorageLayout, cwd: string): Promise<Estimetry> {
  const [
    { createEstimetry },
    { GitCli },
    { FileTaskRepository },
    { FileProjectRepository },
    { YamlConfigStore },
    { SystemClock },
    { RandomIdGenerator },
  ] = await Promise.all([
    import('../application/estimetry.js'),
    import('../infrastructure/git/git-cli.js'),
    import('../infrastructure/persistence/file-task-repository.js'),
    import('../infrastructure/persistence/file-project-repository.js'),
    import('../infrastructure/persistence/yaml-config-store.js'),
    import('../infrastructure/system/system-clock.js'),
    import('../infrastructure/system/random-id-generator.js'),
  ]);
  const git = new GitCli(cwd);
  const config = new YamlConfigStore(layout, () => git.userEmail() ?? userInfo().username);
  return createEstimetry({
    tasks: new FileTaskRepository(layout),
    projects: new FileProjectRepository(layout),
    workspace: git,
    authors: config,
    taskTypes: config,
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
  });
}
