import { Project } from '../../domain/project/project.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import { ProjectIdTaken, ProjectNotFound, type ProjectRepository } from '../../domain/project/project-repository.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { parseProjectSnapshot } from './records.js';
import { registeredPath } from '../fs/worktree.js';

export const PROJECTS_FILE_SCHEMA_VERSION = 1;

/**
 * `projects.yaml`: the global registry of projects and their working copies.
 * Paths are written real (`registeredPath`); reads take them as written, so a
 * hook touches no disk for them. A path written before paths were made real is
 * matched by `findByPath` after a miss, and made real by the next write.
 */
export class FileProjectRepository implements ProjectRepository {
  constructor(private readonly layout: StorageLayout) {}

  /** `path` is a real path (`realPath`). */
  findByPath(path: string): Project | undefined {
    return this.readAll().find((project) => project.hasPath(path)) ?? this.readReal().find((project) => project.hasPath(path));
  }

  ids(): ReadonlySet<string> {
    return new Set(this.readAll().map((project) => project.id.value));
  }

  addIfAbsent(project: Project): Project {
    return withFileLock(this.layout.projectsLock, () => {
      const all = this.readReal();
      const owner = all.find((existing) => project.paths.some((path) => existing.hasPath(path)));
      if (owner) {
        return owner;
      }
      if (all.some((existing) => existing.id.equals(project.id))) {
        throw new ProjectIdTaken(project.id.value);
      }
      this.writeAll([...all, real(project)]);
      return project;
    });
  }

  findById(id: ProjectId): Project | undefined {
    return this.readAll().find((project) => project.id.equals(id));
  }

  update(id: ProjectId, change: (project: Project) => Project): Project {
    return withFileLock(this.layout.projectsLock, () => {
      const all = this.readReal();
      const index = all.findIndex((project) => project.id.equals(id));
      const current = all[index];
      if (!current) {
        throw new ProjectNotFound(id.value);
      }
      const changed = real(change(current));
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

  /** The registry with every path that exists here made real: one `realpath` per path, for writes and a missed lookup. */
  private readReal(): Project[] {
    return this.readAll().map(real);
  }
}

/** The project with its paths made real; two spellings of one copy become one path. */
function real(project: Project): Project {
  const snapshot = project.toSnapshot();
  return Project.rehydrate({ ...snapshot, paths: [...new Set(snapshot.paths.map(registeredPath))] });
}
