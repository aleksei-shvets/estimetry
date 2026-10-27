import { DomainError } from '../shared/domain-error.js';
import type { Project } from './project.js';

export class ProjectIdTaken extends DomainError {
  readonly code = 'project-id-taken';

  constructor(id: string) {
    super(`project id ${id} is already taken`);
  }
}

export interface ProjectRepository {
  findByPath(path: string): Project | undefined;
  ids(): ReadonlySet<string>;
  /**
   * Adds the project atomically. If another project already owns the path, returns
   * that one instead; if the id is taken by a different path, throws ProjectIdTaken.
   */
  addIfAbsent(project: Project): Project;
}
