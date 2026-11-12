import type { ProjectConfigFile } from '../ports/project-config-file.js';
import type { ShareMode } from '../ports/sharing-preference.js';
import type { WorkspaceLocator } from '../ports/workspace-locator.js';
import { defaultFlow, defaultTools, isSharedInstall, unignoredPersonalFiles } from './init-defaults.js';
import type { InstallDependencies } from './install-dependencies.js';

/** What `init` would do by default, for the questions and for the non-interactive run. */
export interface InitChoices {
  readonly projectRoot: string;
  readonly tools: readonly { readonly id: string; readonly title: string }[];
  readonly flows: readonly { readonly id: string; readonly title: string }[];
  readonly defaults: {
    readonly tools: readonly string[];
    readonly flow: string;
    readonly share: ShareMode;
    readonly shared: boolean;
    readonly trackCommits: boolean;
  };
  /** Personal files the default tools write that git does not ignore yet: the user may want them excluded. */
  readonly unignoredPersonalFiles: readonly string[];
}

/** The choices `estimetry init` asks about, with what it would pick by default. */
export class ShowInitChoices {
  constructor(
    private readonly workspace: WorkspaceLocator,
    private readonly projectConfig: ProjectConfigFile,
    private readonly deps: InstallDependencies,
  ) {}

  execute(): InitChoices {
    const root = this.workspace.currentRoot();
    const tools = defaultTools(this.deps, root);
    return {
      projectRoot: root,
      tools: this.deps.registries.tools.all().map(({ id, title }) => ({ id, title })),
      flows: this.deps.registries.flows.all().map(({ id, title }) => ({ id, title })),
      defaults: {
        tools: tools.map((tool) => tool.id),
        flow: defaultFlow(this.deps, this.projectConfig, root),
        share: this.deps.sharing.mode() ?? 'none',
        shared: isSharedInstall(this.deps, root, tools),
        trackCommits: this.deps.git.commitHook.installed(root),
      },
      unignoredPersonalFiles: unignoredPersonalFiles(this.deps, root, tools),
    };
  }
}
