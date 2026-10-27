import { Project } from '../../domain/project/project.js';
import { ProjectId } from '../../domain/project/project-id.js';
import { ProjectIdTaken, type ProjectRepository } from '../../domain/project/project-repository.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { Clock } from '../ports/clock.js';
import type { WorkspaceLocator } from '../ports/workspace-locator.js';

const MAX_REGISTRATION_ATTEMPTS = 5;

/**
 * Maps the working copy to a project. Commands that write register it on first
 * use; read-only commands only look it up, so they never create state.
 */
export class ResolveCurrentProject {
  constructor(
    private readonly workspace: WorkspaceLocator,
    private readonly projects: ProjectRepository,
    private readonly authors: AuthorProvider,
    private readonly clock: Clock,
  ) {}

  find(): Project | undefined {
    return this.projects.findByPath(this.workspace.currentRoot());
  }

  findOrRegister(): Project {
    const root = this.workspace.currentRoot();
    const existing = this.projects.findByPath(root);
    if (existing) {
      return existing;
    }
    const name = baseName(root);
    for (let attempt = 1; ; attempt++) {
      const id = ProjectId.firstFree(ProjectId.fromName(name), this.projects.ids());
      try {
        return this.projects.addIfAbsent(
          Project.register({ id, name, path: root }, this.authors.current(), this.clock.now()),
        );
      } catch (error) {
        // Another process took the id between ids() and addIfAbsent(); pick the next free one.
        if (!(error instanceof ProjectIdTaken) || attempt >= MAX_REGISTRATION_ATTEMPTS) {
          throw error;
        }
      }
    }
  }
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? 'project';
}
