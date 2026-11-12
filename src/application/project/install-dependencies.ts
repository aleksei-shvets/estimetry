import type { Installation } from '../ports/estimetry-runner.js';
import type { Flows, StackDetectors, ToolAdapters } from '../contracts/registries.js';
import type { CommandLocator } from '../ports/command-locator.js';
import type { CommitHookInstaller } from '../ports/commit-hook-installer.js';
import type { GitExcludes } from '../ports/git-excludes.js';
import type { ProjectFiles } from '../ports/project-files.js';
import type { SharingPreference } from '../ports/sharing-preference.js';

/** What `init` chooses from: AI tools, flows and detectors of the stack. */
export interface InstallRegistries {
  readonly tools: ToolAdapters;
  readonly flows: Flows;
  readonly detectors: StackDetectors;
}

/** What `init` changes in git besides the project's files: the commit hook and the global excludes. */
export interface InstallGit {
  readonly commitHook: CommitHookInstaller;
  readonly excludes: GitExcludes;
}

/** Everything `init` needs besides the registry of projects; built by the composition root. */
export interface InstallDependencies {
  readonly files: ProjectFiles;
  readonly registries: InstallRegistries;
  readonly git: InstallGit;
  readonly sharing: SharingPreference;
  readonly commands: CommandLocator;
  /** This installation of estimetry: its version and how hooks start it. */
  readonly installation: Installation;
}
