import { Project } from '../../domain/project/project.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import { ProjectIdTaken, ProjectNotFound, type ProjectRepository } from '../../domain/project/project-repository.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { parseProjectSnapshot } from './records.js';

export const PROJECTS_FILE_SCHEMA_VERSION = 1;

/** `projects.yaml`: the global registry of projects and their working copies. */
export class FileProjectRepository implements ProjectRepository {
  constructor(private readonly layout: StorageLayout) {}

  findByPath(path: string): Project | undefined {
    return this.readAll().find((project) => project.hasPath(path));
  }

  ids(): ReadonlySet<string> {
    return new Set(this.readAll().map((project) => project.id.value));
  }

  addIfAbsent(project: Project): Project {
    return withFileLock(this.layout.projectsLock, () => {
      const all = this.readAll();
      const owner = all.find((existing) => project.paths.some((path) => existing.hasPath(path)));
      if (owner) {
        return owner;
      }
      if (all.some((existing) => existing.id.equals(project.id))) {
        throw new ProjectIdTaken(project.id.value);
      }
      this.writeAll([...all, project]);
      return project;
    });
  }

  findById(id: ProjectId): Project | undefined {
    return this.readAll().find((project) => project.id.equals(id));
  }

  update(id: ProjectId, change: (project: Project) => Project): Project {
    return withFileLock(this.layout.projectsLock, () => {
      const all = this.readAll();
      const index = all.findIndex((project) => project.id.equals(id));
      const current = all[index];
      if (!current) {
        throw new ProjectNotFound(id.value);
      }
      const changed = change(current);
      all[index] = changed;
      this.writeAll(all);
      return changed;
    });
  }

  private writeAll(projects: readonly Project[]): void {
    writeYamlAtomic(this.layout.projectsFile, {
      schemaVersion: PROJECTS_FILE_SCHEMA_VERSION,
      projects: projects.map((p) => p.toSnapshot()),
    });
  }

  private readAll(): Project[] {
    const document = readYaml(this.layout.projectsFile);
    const entries =
      typeof document === 'object' && document !== null && Array.isArray((document as { projects?: unknown }).projects)
        ? (document as { projects: unknown[] }).projects
        : [];
    return entries
      .map(parseProjectSnapshot)
      .filter((snapshot) => snapshot !== undefined)
      .map((snapshot) => Project.rehydrate(snapshot));
  }
}
