import type { InstallDependencies } from './install-dependencies.js';
import type { ProjectRepository } from '../../domain/project/project-repository.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { Flow } from '../contracts/flow.js';
import type { ToolAdapter } from '../contracts/tool-adapter.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import { isShareMode, SHARE_MODES, type ShareMode } from '../ports/sharing-preference.js';
import type { WorkspaceLocator } from '../ports/workspace-locator.js';
import type { RegistrationPlan, ResolveCurrentProject } from './resolve-current-project.js';
import { defaultFlow, defaultTools, isSharedInstall } from './init-defaults.js';
import type { InstallCopy, PlannedFile } from './install-copy.js';
import { detectStack } from './stack.js';
import type { ProjectId } from '../../domain/project/project-id.js';


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


export interface InitReport {
  readonly project: string;
  readonly flow: string;
  readonly tools: readonly string[];
  readonly stack: readonly string[];
  readonly share: ShareMode;
  /** Paths inside the project are relative to its root, others are absolute. */
  readonly files: readonly PlannedFile[];
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
    private readonly install: InstallCopy,
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
    const shared = input.shared ?? isSharedInstall(this.deps, root, tools);
    const trackCommits = input.trackCommits ?? this.deps.git.commitHook.installed(root);
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
    const stack = detectStack(root, this.deps.files, this.deps.registries.detectors.all());
    warnings.push(...stack.warnings);

    const plan = this.install.plan({
      root,
      project: config.config?.project ?? plannedId(registration),
      tools,
      flow,
      shared,
      trackCommits,
      force: input.force ?? false,
      ...(input.excludePersonalFiles === undefined ? {} : { excludePersonalFiles: input.excludePersonalFiles }),
    });

    const project = this.projects.update(this.currentProject.register(registration).id, (registered) => {
      const fingerprint = this.workspace.fingerprint();
      const withStack = registered.withStack(stack.tags);
      return fingerprint !== undefined && registered.fingerprint === undefined ? withStack.withFingerprint(fingerprint) : withStack;
    });
    this.install.apply(plan);
    if (this.deps.sharing.mode() !== share) {
      this.deps.sharing.save(share);
    }
    // Personal hooks run this installation by its paths; shared ones, and all without paths (npx, Windows), need PATH.
    if ((shared || this.deps.installation.runner === undefined) && !this.deps.commands.has(HOOK_COMMAND)) {
      warnings.push(
        `${HOOK_COMMAND} is not on PATH, so the hooks will not run until the package is installed globally (npm install -g estimetry)`,
      );
    }
    return {
      project: project.id.value,
      flow: flow.id,
      tools: tools.map((tool) => tool.id),
      stack: project.stack,
      share,
      files: plan.entries.map((entry) => entry.file),
      warnings: [...warnings, ...plan.warnings],
    };
  }

  private toolsById(ids: readonly string[]): ToolAdapter[] {
    const tools = ids.map((id) => {
      const tool = this.deps.registries.tools.get(id.trim());
      if (!tool) {
        throw new InvalidValue(`unknown tool "${id}", expected one of: ${this.deps.registries.tools.all().map((t) => t.id).join(', ')}`);
      }
      return tool;
    });
    if (tools.length === 0) {
      throw new InvalidValue('choose at least one tool');
    }
    return [...new Set(tools)];
  }

  private flowById(id: string): Flow {
    const flow = this.deps.registries.flows.get(id);
    if (!flow) {
      throw new InvalidValue(`unknown flow "${id}", expected one of: ${this.deps.registries.flows.all().map((f) => f.id).join(', ')}`);
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

function plannedId(plan: RegistrationPlan): ProjectId {
  return plan.kind === 'new' ? plan.id : plan.project.id;
}
