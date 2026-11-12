import type { Project } from '../../domain/project/project.js';
import type { ProjectRepository } from '../../domain/project/project-repository.js';
import { ProjectId } from '../../domain/project/project-id.js';
import type { InstallVersions } from '../ports/install-versions.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import { defaultFlow, installedTools, isSharedInstall } from './init-defaults.js';
import type { InstallDependencies } from './install-dependencies.js';
import type { CopyPlan, InstallCopy, PlannedFile } from './install-copy.js';

/** A working copy `upgrade` installs into again, with its plan. */
export interface CopyUpgrade {
  readonly project: string;
  readonly root: string;
  /** The version the copy was set up by; undefined when it was not recorded. */
  readonly installedBy?: string;
  /** The copy has a shared install: the files it changes are committed by the project. */
  readonly shared: boolean;
  readonly plan: CopyPlan;
  /** The files the plan changes; a file outside the copy (a personal skill) only under the first copy that has it. */
  readonly files: readonly PlannedFile[];
  /** Warnings of the plan; one that an earlier copy already gave is left out. */
  readonly warnings: readonly string[];
}

/** A working copy `upgrade` leaves alone, and why. */
export interface SkippedCopy {
  readonly project: string;
  readonly root: string;
  readonly reason: string;
}

/** The copies of every registered project on this machine: what upgrading them would do. */
export interface UpgradeCopies {
  readonly version: string;
  readonly copies: readonly CopyUpgrade[];
  readonly skipped: readonly SkippedCopy[];
}

type Planned = Omit<CopyUpgrade, 'files' | 'warnings'>;

/**
 * Plans `upgrade` (project-init spec): every working copy of every registered
 * project, each with the choices `init` would keep in it — the tools installed
 * in it, its flow, a shared or personal install, the commit hook. A copy without
 * an installed tool is not set up, so it is skipped: upgrading does not install.
 */
export class UpgradePlanner {
  constructor(
    private readonly projects: Pick<ProjectRepository, 'ids' | 'findById'>,
    private readonly projectConfig: ProjectConfigFile,
    private readonly deps: InstallDependencies,
    private readonly install: Pick<InstallCopy, 'plan'>,
    private readonly versions: Pick<InstallVersions, 'read'>,
  ) {}

  plan(): UpgradeCopies {
    const copies: CopyUpgrade[] = [];
    const skipped: SkippedCopy[] = [];
    const seenFiles = new Set<string>();
    const seenWarnings = new Set<string>();
    const first = (seen: Set<string>, value: string): boolean => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    };
    for (const project of this.registered()) {
      for (const root of project.paths) {
        const result = this.copy(project, root);
        if ('reason' in result) {
          skipped.push(result);
          continue;
        }
        const files = result.plan.entries
          .filter((entry) => first(seenFiles, entry.target) && entry.file.status !== 'unchanged')
          .map((entry) => entry.file);
        const warnings = result.plan.warnings.filter((warning) => first(seenWarnings, warning));
        copies.push({ ...result, files, warnings });
      }
    }
    return { version: this.deps.version, copies, skipped };
  }

  private copy(project: Project, root: string): Planned | SkippedCopy {
    const id = project.id.value;
    if (!this.deps.files.isDirectory(root)) {
      return { project: id, root, reason: 'not on this machine' };
    }
    const tools = installedTools(this.deps, root);
    if (tools.length === 0) {
      const unreadable = this.deps.registries.tools.all().flatMap((tool) => tool.state(root, this.deps.files).unreadable ?? []);
      return { project: id, root, reason: unreadable[0] ?? 'not set up; run `emt init` there' };
    }
    const config = this.projectConfig.read(root);
    const flow = this.deps.registries.flows.get(defaultFlow(this.deps, this.projectConfig, root));
    if (flow === undefined) {
      return { project: id, root, reason: 'no flow to set up' };
    }
    const shared = isSharedInstall(this.deps, root, tools);
    try {
      const planned = this.install.plan({
        root,
        project: config.config?.project ?? project.id,
        tools,
        flow,
        shared,
        trackCommits: this.deps.git.commitHook.installed(root),
        force: false,
      });
      const plan = config.warning === undefined ? planned : { ...planned, warnings: [config.warning, ...planned.warnings] };
      const installedBy = this.versions.read(root);
      return { project: id, root, shared, plan, ...(installedBy === undefined ? {} : { installedBy }) };
    } catch (error) {
      // A copy that cannot be planned does not stop the others.
      return { project: id, root, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private registered(): Project[] {
    return [...this.projects.ids()]
      .sort()
      .flatMap((id) => {
        const project = this.projects.findById(ProjectId.parse(id));
        return project === undefined ? [] : [project];
      });
  }
}
