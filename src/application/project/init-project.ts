import type { ProjectRepository } from '../../domain/project/project-repository.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import { isRemoval, mergePlans, type FileChange, type InstallPlan } from '../contracts/file-change.js';
import type { Flow } from '../contracts/flow.js';
import type { Flows, StackDetectors, ToolAdapters } from '../contracts/registries.js';
import type { ToolAdapter } from '../contracts/tool-adapter.js';
import type { CommandLocator } from '../ports/command-locator.js';
import type { CommitHookInstaller } from '../ports/commit-hook-installer.js';
import type { GitExcludes } from '../ports/git-excludes.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import type { ProjectFiles } from '../ports/project-files.js';
import type { ProjectPaths } from '../ports/project-paths.js';
import { isShareMode, SHARE_MODES, type ShareMode, type SharingPreference } from '../ports/sharing-preference.js';
import type { WorkspaceLocator } from '../ports/workspace-locator.js';
import type { RegistrationPlan, ResolveCurrentProject } from './resolve-current-project.js';
import { defaultFlow, defaultTools, unignoredPersonalFiles } from './init-defaults.js';
import { detectStack } from './stack.js';

/** Everything `init` needs besides the registry; built by the composition root. */
export interface InstallDependencies {
  readonly files: ProjectFiles;
  readonly tools: ToolAdapters;
  readonly flows: Flows;
  readonly detectors: StackDetectors;
  readonly commitHook: CommitHookInstaller;
  readonly sharing: SharingPreference;
  readonly commands: CommandLocator;
  readonly excludes: GitExcludes;
  /** Version of estimetry, stamped into generated files. */
  readonly version: string;
}

export interface InitInput {
  /** Ids or aliases; omitted — what is installed, else every available tool. */
  readonly tools?: readonly string[];
  readonly flow?: string;
  readonly share?: string;
  readonly trackCommits?: boolean;
  readonly shared?: boolean;
  readonly force?: boolean;
  /** The user agreed to add personal files to the global git excludes; omitted — only warn. */
  readonly excludePersonalFiles?: boolean;
}

export type FileStatus = 'created' | 'updated' | 'removed' | 'unchanged' | 'skipped';

export interface InitReport {
  readonly project: string;
  readonly flow: string;
  readonly tools: readonly string[];
  readonly stack: readonly string[];
  readonly share: ShareMode;
  /** Paths inside the project are relative to its root, others are absolute. */
  readonly files: readonly { readonly path: string; readonly status: FileStatus; readonly reason?: string }[];
  readonly warnings: readonly string[];
}

const HOOK_COMMAND = 'estimetry';

export class InitProject {
  constructor(
    private readonly workspace: WorkspaceLocator,
    private readonly currentProject: ResolveCurrentProject,
    private readonly projects: ProjectRepository,
    private readonly projectConfig: ProjectConfigFile,
    private readonly deps: InstallDependencies,
  ) {}

  /**
   * Validates the choices, plans every change, and only then registers the
   * project and writes files: a failed plan leaves the registry and the files as they were.
   */
  execute(input: InitInput): InitReport {
    const root = this.workspace.currentRoot();
    const tools = input.tools === undefined ? defaultTools(this.deps, root) : this.toolsById(input.tools);
    const flow = this.flowById(input.flow ?? defaultFlow(this.deps, this.projectConfig, root));
    const share = this.shareMode(input.share ?? this.deps.sharing.mode() ?? 'none');
    const shared = input.shared ?? tools.some((tool) => tool.state(root, this.deps.files).shared);
    const trackCommits = input.trackCommits ?? this.deps.commitHook.installed(root);
    const warnings: string[] = [];

    const registration = this.currentProject.planRegistration();
    if (registration.kind === 'new' && registration.warning !== undefined) {
      warnings.push(registration.warning);
    }
    const config = this.projectConfig.read(root);
    if (config.warning !== undefined) {
      warnings.push(config.warning);
    }
    const setupHint = flow.setupHint?.(root, this.deps.files);
    if (setupHint !== undefined) {
      warnings.push(setupHint);
    }
    const stack = detectStack(root, this.deps.files, this.deps.detectors.all());
    warnings.push(...stack.warnings);

    const plan = mergePlans([
      ...tools.map((tool) =>
        tool.plan({ projectRoot: root, files: this.deps.files, shared, force: input.force ?? false, version: this.deps.version }),
      ),
      this.deps.commitHook.plan(root, trackCommits),
      { changes: [this.projectConfig.plan(root, { project: config.config?.project ?? plannedId(registration), flow: flow.id })], skipped: [], warnings: [] },
      shared ? EMPTY : this.excludePersonalFiles(root, tools, input.excludePersonalFiles),
    ]);

    const project = this.projects.update(this.currentProject.register(registration).id, (registered) => {
      const fingerprint = this.workspace.fingerprint();
      const withStack = registered.withStack(stack.tags);
      return fingerprint !== undefined && registered.fingerprint === undefined ? withStack.withFingerprint(fingerprint) : withStack;
    });
    const files = [
      ...plan.changes.map((change) => ({ path: display(this.deps.files, root, change.path), status: this.apply(change) })),
      ...plan.skipped.map((skip) => ({ path: display(this.deps.files, root, skip.path), status: 'skipped' as const, reason: skip.reason })),
    ];
    if (this.deps.sharing.mode() !== share) {
      this.deps.sharing.save(share);
    }
    if (!this.deps.commands.has(HOOK_COMMAND)) {
      warnings.push(`${HOOK_COMMAND} is not on PATH, so the hooks will not run until the package is installed globally (npm install -g estimetry)`);
    }
    return {
      project: project.id.value,
      flow: flow.id,
      tools: tools.map((tool) => tool.id),
      stack: project.stack,
      share,
      files,
      warnings: [...warnings, ...plan.warnings],
    };
  }

  private apply(change: FileChange): FileStatus {
    const current = this.deps.files.read(change.path);
    if (isRemoval(change)) {
      if (current === undefined) {
        return 'unchanged';
      }
      this.deps.files.remove(change.path);
      return 'removed';
    }
    if (current === change.content) {
      return 'unchanged';
    }
    this.deps.files.write(change.path, change.content, change.executable ? { executable: true } : {});
    return current === undefined ? 'created' : 'updated';
  }

  /** Personal files must stay out of git; with consent they go to the global excludes, as Claude Code does. */
  private excludePersonalFiles(root: string, tools: readonly ToolAdapter[], consent: boolean | undefined): InstallPlan {
    const unignored = unignoredPersonalFiles(this.deps, root, tools);
    if (unignored.length === 0) {
      return EMPTY;
    }
    const file = this.deps.excludes.globalFile();
    const patterns = unignored.map((path) => `**/${this.deps.files.portable(path)}`);
    if (consent !== true) {
      return {
        changes: [],
        skipped: [],
        warnings: unignored.map(
          (path, i) => `${path} is not ignored by git and may be committed; to keep it out of every repository: echo '${patterns[i]}' >> ${file}`,
        ),
      };
    }
    const current = this.deps.files.read(file) ?? '';
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    return { changes: [{ path: file, content: `${current}${separator}${patterns.join('\n')}\n` }], skipped: [], warnings: [] };
  }

  private toolsById(ids: readonly string[]): ToolAdapter[] {
    const tools = ids.map((id) => {
      const tool = this.deps.tools.get(id.trim());
      if (!tool) {
        throw new InvalidValue(`unknown tool "${id}", expected one of: ${this.deps.tools.all().map((t) => t.id).join(', ')}`);
      }
      return tool;
    });
    if (tools.length === 0) {
      throw new InvalidValue('choose at least one tool');
    }
    return [...new Set(tools)];
  }

  private flowById(id: string): Flow {
    const flow = this.deps.flows.get(id);
    if (!flow) {
      throw new InvalidValue(`unknown flow "${id}", expected one of: ${this.deps.flows.all().map((f) => f.id).join(', ')}`);
    }
    return flow;
  }

  private shareMode(value: string): ShareMode {
    if (!isShareMode(value)) {
      throw new InvalidValue(`unknown share mode "${value}", expected one of: ${SHARE_MODES.join(', ')}`);
    }
    return value;
  }
}

const EMPTY: InstallPlan = { changes: [], skipped: [], warnings: [] };

function plannedId(plan: RegistrationPlan): string {
  return plan.kind === 'new' ? plan.id.value : plan.project.id.value;
}

/** Relative inside the project, absolute outside it. */
function display(paths: ProjectPaths, root: string, path: string): string {
  return paths.inside(root, path) ?? path;
}

