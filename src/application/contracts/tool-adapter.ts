import type { EstimetryRunner } from '../ports/estimetry-runner.js';
import type { ProjectFiles } from '../ports/project-files.js';
import type { InstallPlan } from '../ports/file-change.js';

export interface InstallContext {
  readonly projectRoot: string;
  readonly files: ProjectFiles;
  /** Install for the whole team (files the project commits) instead of for this user only. */
  readonly shared: boolean;
  /** Overwrite generated files the user has edited since they were installed. */
  readonly force: boolean;
  /** Version of estimetry, stamped into generated files. */
  readonly version: string;
  /** How hooks start this installation; omitted — `estimetry` from PATH. */
  readonly runner?: EstimetryRunner;
}

/** What is installed now; `init` takes its defaults from here, not from saved choices. */
export interface ToolState {
  readonly installed: boolean;
  readonly shared: boolean;
  /** A settings file of the tool that cannot be read: whether the tool is installed is unknown. */
  readonly unreadable?: string;
}

/** One AI tool: what `init` installs for it and which hook events it sends. */
export interface ToolAdapter {
  readonly id: string;
  /** Other names accepted by `--tools`, e.g. `claude` for `claude-code`. */
  readonly aliases: readonly string[];
  readonly title: string;
  /** Events the installed hooks report; the hook receiver accepts only these. */
  readonly hookEvents: readonly string[];
  state(projectRoot: string, files: ProjectFiles): ToolState;
  /**
   * Files inside the project that this tool writes for this user only (when the
   * install is not shared); they must stay out of git. Relative to the project root.
   */
  personalFiles(): readonly string[];
  /** Throws InstallBlocked when the plan cannot be made safely. */
  plan(context: InstallContext): InstallPlan;
}
