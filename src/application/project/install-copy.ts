import type { ProjectId } from '../../domain/project/project-id.js';
import type { Flow } from '../contracts/flow.js';
import type { ToolAdapter } from '../contracts/tool-adapter.js';
import { EMPTY_PLAN, isRemoval, mergePlans, type FileChange, type InstallPlan } from '../ports/file-change.js';
import type { InstallVersions } from '../ports/install-versions.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import { unignoredPersonalFiles } from './init-defaults.js';
import type { InstallDependencies } from './install-dependencies.js';

export type FileStatus = 'created' | 'updated' | 'removed' | 'unchanged' | 'skipped';

/** What goes into one working copy: the same for `init` in it and for `upgrade` of every copy. */
export interface CopyChoices {
  readonly root: string;
  /** The id the project config of the copy keeps. */
  readonly project: ProjectId;
  readonly tools: readonly ToolAdapter[];
  readonly flow: Flow;
  readonly shared: boolean;
  readonly trackCommits: boolean;
  readonly force: boolean;
  /** The user agreed to add personal files to the global git excludes; omitted — only warn. */
  readonly excludePersonalFiles?: boolean;
}

/** A file of the plan with what writing it would do. Paths inside the copy are relative to it, others absolute. */
export interface PlannedFile {
  readonly path: string;
  readonly status: FileStatus;
  readonly reason?: string;
}

/** A file of the plan with its absolute path: the same file (a personal skill) may belong to several copies. */
export interface PlanEntry {
  readonly target: string;
  readonly file: PlannedFile;
}

/** The plan of one copy: nothing is written until it is applied. */
export interface CopyPlan {
  readonly root: string;
  readonly entries: readonly PlanEntry[];
  readonly warnings: readonly string[];
  readonly changes: readonly FileChange[];
}

/**
 * Installs estimetry into one working copy (project-init spec): the hooks and
 * skills of its tools, the commit hook, the project config, and records the
 * version it was set up by. Planning writes nothing.
 */
export class InstallCopy {
  constructor(
    private readonly deps: InstallDependencies,
    private readonly projectConfig: ProjectConfigFile,
    private readonly versions: Pick<InstallVersions, 'record'>,
  ) {}

  plan(choices: CopyChoices): CopyPlan {
    const { root } = choices;
    const { version, runner } = this.deps.installation;
    const context = { projectRoot: root, files: this.deps.files, shared: choices.shared, force: choices.force, version };
    const plan = mergePlans([
      ...choices.tools.map((tool) => tool.plan(runner === undefined ? context : { ...context, runner })),
      this.deps.git.commitHook.plan(root, choices.trackCommits, runner),
      { changes: [this.projectConfig.plan(root, { project: choices.project, flow: choices.flow.id })], skipped: [], warnings: [] },
      choices.shared ? EMPTY_PLAN : this.excludePersonalFiles(root, choices.tools, choices.excludePersonalFiles),
    ]);
    return {
      root,
      entries: [
        ...plan.changes.map((change) => ({
          target: change.path,
          file: { path: this.display(root, change.path), status: this.statusOf(change) },
        })),
        ...plan.skipped.map((skip) => ({
          target: skip.path,
          file: { path: this.display(root, skip.path), status: 'skipped' as const, reason: skip.reason },
        })),
      ],
      warnings: plan.warnings,
      changes: plan.changes,
    };
  }

  /** Writes the plan and records the version of the copy. */
  apply(plan: CopyPlan): void {
    for (const change of plan.changes) {
      if (this.statusOf(change) === 'unchanged') {
        continue;
      }
      if (isRemoval(change)) {
        this.deps.files.remove(change.path);
      } else {
        this.deps.files.write(change.path, change.content, change.executable ? { executable: true } : {});
      }
    }
    this.versions.record(plan.root, this.deps.installation.version);
  }

  private statusOf(change: FileChange): FileStatus {
    const current = this.deps.files.read(change.path);
    if (isRemoval(change)) {
      return current === undefined ? 'unchanged' : 'removed';
    }
    if (current === change.content) {
      return 'unchanged';
    }
    return current === undefined ? 'created' : 'updated';
  }

  /** Personal files must stay out of git; with consent they go to the global excludes, as Claude Code does. */
  private excludePersonalFiles(root: string, tools: readonly ToolAdapter[], consent: boolean | undefined): InstallPlan {
    const unignored = unignoredPersonalFiles(this.deps, root, tools);
    if (unignored.length === 0) {
      return EMPTY_PLAN;
    }
    const file = this.deps.git.excludes.globalFile();
    const patterns = unignored.map((path) => `**/${this.deps.files.portable(path)}`);
    if (consent !== true) {
      return {
        changes: [],
        skipped: [],
        warnings: unignored.map(
          (path, i) =>
            `${path} is not ignored by git and may be committed; to keep it out of every repository: echo '${patterns[i]}' >> ${file}`,
        ),
      };
    }
    const current = this.deps.files.read(file) ?? '';
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    return { changes: [{ path: file, content: `${current}${separator}${patterns.join('\n')}\n` }], skipped: [], warnings: [] };
  }

  /** Relative inside the copy, absolute outside it. */
  private display(root: string, path: string): string {
    return this.deps.files.inside(root, path) ?? path;
  }
}
