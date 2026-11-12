import { Project } from '../../domain/project/project.js';
import { ProjectId } from '../../domain/project/project-id.js';
import { ProjectIdTaken, type ProjectRepository } from '../../domain/project/project-repository.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { Clock } from '../ports/clock.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import type { WorkspaceLocator } from '../ports/workspace-locator.js';

const MAX_REGISTRATION_ATTEMPTS = 5;

/** How the working copy maps to the registry; computed without writing anything. */
export type RegistrationPlan =
  | { readonly kind: 'existing'; readonly project: Project }
  /** Another clone of a registered repository: its path joins that project. */
  | { readonly kind: 'join'; readonly project: Project; readonly path: string }
  | {
      readonly kind: 'new';
      readonly id: ProjectId;
      readonly name: string;
      readonly path: string;
      readonly fingerprint?: string;
      /** Set when the id from `.estimetry/config.yaml` belongs to another repository. */
      readonly warning?: string;
    };

/**
 * Maps the working copy to a project. Commands that write register it on first
 * use; read-only commands only look it up, so they never create state.
 */
export class ResolveCurrentProject {
  constructor(
    private readonly workspace: WorkspaceLocator,
    private readonly projects: ProjectRepository,
    private readonly projectConfig: ProjectConfigFile,
    private readonly authors: AuthorProvider,
    private readonly clock: Clock,
  ) {}

  find(): Project | undefined {
    return this.projects.findByPath(this.workspace.currentRoot());
  }

  findOrRegister(): Project {
    for (let attempt = 1; ; attempt++) {
      try {
        return this.register(this.planRegistration());
      } catch (error) {
        // Another process took the id between planning and adding; plan again.
        if (!(error instanceof ProjectIdTaken) || attempt >= MAX_REGISTRATION_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /**
   * The id comes from `.estimetry/config.yaml` when it names one: a clone of the
   * same repository (same fingerprint) joins that project, another repository with
   * the same id gets a suffix. Without the file the id comes from the directory name.
   */
  planRegistration(): RegistrationPlan {
    const root = this.workspace.currentRoot();
    const existing = this.projects.findByPath(root);
    if (existing) {
      return { kind: 'existing', project: existing };
    }
    const fingerprint = this.workspace.fingerprint();
    const repository = fingerprint === undefined ? {} : { fingerprint };
    const name = baseName(root);
    const configured = this.configuredId(root);
    if (configured === undefined) {
      return { kind: 'new', id: this.firstFree(ProjectId.fromName(name)), name, path: root, ...repository };
    }
    const owner = this.projects.findById(configured);
    if (!owner) {
      return { kind: 'new', id: configured, name, path: root, ...repository };
    }
    if (owner.sameRepository(fingerprint)) {
      return { kind: 'join', project: owner, path: root };
    }
    const id = this.firstFree(configured);
    return {
      kind: 'new',
      id,
      name,
      path: root,
      ...repository,
      warning:
        `project ${configured} from .estimetry/config.yaml is another repository in your registry, ` +
        `so this one is registered as ${id.value}`,
    };
  }

  register(plan: RegistrationPlan): Project {
    switch (plan.kind) {
      case 'existing':
        return plan.project;
      case 'join':
        return this.projects.update(plan.project.id, (project) => project.withPath(plan.path));
      case 'new':
        return this.projects.addIfAbsent(
          Project.register(
            { id: plan.id, name: plan.name, path: plan.path, ...(plan.fingerprint === undefined ? {} : { fingerprint: plan.fingerprint }) },
            this.authors.current(),
            this.clock.now(),
          ),
        );
    }
  }

  private configuredId(root: string): ProjectId | undefined {
    // A broken id in the config is no id: it comes from the directory name then.
    return this.projectConfig.read(root).config?.project;
  }

  private firstFree(base: ProjectId): ProjectId {
    return ProjectId.firstFree(base, this.projects.ids());
  }
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? 'project';
}
