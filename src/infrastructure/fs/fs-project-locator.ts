import { sep } from 'node:path';
import type { LocatedProject, ProjectLocator } from '../../application/ports/project-locator.js';
import { readYaml } from './atomic-yaml.js';
import { mainWorktree, realPath, registeredPath } from './worktree.js';
import type { StorageLayout } from './storage-layout.js';
import { ProjectId } from '../../domain/project/project-id.js';

/**
 * Finds the registered project of a directory without running git: real
 * paths, the main working copy of a git worktree (`.git` file → gitdir →
 * commondir), then the longest registered path that holds the directory.
 */
export class FsProjectLocator implements ProjectLocator {
  constructor(private readonly layout: StorageLayout) {}

  locate(directory: string): LocatedProject | undefined {
    const real = realPath(directory);
    if (real === undefined) {
      return undefined;
    }
    const main = mainWorktree(real) ?? real;
    const registered = this.registered();
    const found = longestOwner(registered, real) ?? longestOwner(registered, main);
    if (found !== undefined) {
      return found;
    }
    // A path registered before paths were made real (a symlink, another case on macOS): only on a miss the disk is asked.
    const madeReal = registered.map(({ id, path }) => ({ id, path: registeredPath(path) }));
    return longestOwner(madeReal, real) ?? longestOwner(madeReal, main);
  }

  private registered(): { id: string; path: string }[] {
    let document: unknown;
    try {
      document = readYaml(this.layout.projectsFile);
    } catch {
      return [];
    }
    const projects = (document as { projects?: unknown } | undefined)?.projects;
    if (!Array.isArray(projects)) {
      return [];
    }
    return projects.flatMap((p: unknown) => {
      const project = p as { id?: unknown; paths?: unknown };
      return typeof project.id === 'string' && isProjectId(project.id) && Array.isArray(project.paths)
        ? project.paths
            .filter((path): path is string => typeof path === 'string')
            .map((path) => ({ id: project.id as string, path }))
        : [];
    });
  }
}

function longestOwner(registered: readonly { id: string; path: string }[], directory: string): LocatedProject | undefined {
  const owner = registered
    .filter(({ path }) => directory === path || directory.startsWith(path.endsWith(sep) ? path : `${path}${sep}`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return owner === undefined ? undefined : { id: ProjectId.parse(owner.id), root: owner.path };
}


function isProjectId(value: string): boolean {
  try {
    ProjectId.parse(value);
    return true;
  } catch {
    return false; // a broken registry entry is skipped, as one without paths is
  }
}
