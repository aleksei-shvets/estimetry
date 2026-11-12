import { DomainError } from '../shared/domain-error.js';
import type { ProjectId } from './project-id.js';
import type { Project } from './project.js';

export class ProjectIdTaken extends DomainError {
  readonly code = 'project-id-taken';

  constructor(id: string) {
    super(`project id ${id} is already taken`);
  }
}

export class ProjectNotFound extends DomainError {
  readonly code = 'project-not-found';

  constructor(id: string) {
    super(`project ${id} not found`);
  }
}

export interface ProjectRepository {
  /** `path` is a real path, as `WorkspaceLocator.currentRoot` gives it. */
  findByPath(path: string): Project | undefined;
  ids(): ReadonlySet<string>;
  /**
   * Adds the project atomically. If another project already owns the path, returns
   * that one instead; if the id is taken by a different path, throws ProjectIdTaken.
   */
  addIfAbsent(project: Project): Project;
  /**
   * Re-reads the project, applies `change` and saves it in one locked step, so a
   * project registered meanwhile by another process is not lost. Throws if the id is unknown.
   */
  update(id: ProjectId, change: (project: Project) => Project): Project;
  findById(id: ProjectId): Project | undefined;
}
