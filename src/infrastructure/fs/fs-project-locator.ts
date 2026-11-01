import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { LocatedProject, ProjectLocator } from '../../application/ports/project-locator.js';
import { readYaml } from './atomic-yaml.js';
import type { StorageLayout } from './storage-layout.js';

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
    const registered = this.registered();
    return longestOwner(registered, real) ?? longestOwner(registered, mainWorktree(real) ?? real);
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
      return typeof project.id === 'string' && Array.isArray(project.paths)
        ? project.paths.filter((path): path is string => typeof path === 'string').map((path) => ({ id: project.id as string, path }))
        : [];
    });
  }
}

function longestOwner(registered: readonly { id: string; path: string }[], directory: string): LocatedProject | undefined {
  const owner = registered
    .filter(({ path }) => directory === path || directory.startsWith(path.endsWith(sep) ? path : `${path}${sep}`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return owner === undefined ? undefined : { id: owner.id, root: owner.path };
}

/** For a directory inside a linked worktree, the root of the main working copy. */
export function mainWorktree(directory: string): string | undefined {
  for (let dir = directory; ; dir = dirname(dir)) {
    const dotGit = join(dir, '.git');
    try {
      const stat = statSync(dotGit);
      if (stat.isDirectory()) {
        return undefined; // the main working copy itself
      }
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
      if (gitdir === undefined) {
        return undefined;
      }
      const worktreeDir = isAbsolute(gitdir) ? gitdir : resolve(dir, gitdir);
      const common = readFileSync(join(worktreeDir, 'commondir'), 'utf8').trim();
      const commonDir = isAbsolute(common) ? common : resolve(worktreeDir, common);
      return realPath(dirname(commonDir));
    } catch {
      if (dirname(dir) === dir) {
        return undefined;
      }
    }
  }
}

function realPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
