import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/*
 * Git worktrees without running git: a linked worktree has a `.git` file that
 * names its directory in the repository, whose `commondir` leads to the `.git`
 * of the main working copy. The CLI and the hooks find the same main copy here.
 */

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
      // Only a `.git` inside a working copy has one: a bare repository or a separate git dir has no main working copy.
      return basename(commonDir) === '.git' ? realPath(dirname(commonDir)) : undefined;
    } catch {
      if (dirname(dir) === dir) {
        return undefined;
      }
    }
  }
}

/**
 * The real path, or undefined when it does not exist: symlinks resolved and,
 * on a file system that ignores case (macOS), the case the disk keeps — so a
 * directory spelled otherwise is the same path in the registry. The one place
 * paths are made real. Where the native call fails for another reason (a
 * virtual file system, Linux without `/proc`) the JS one resolves symlinks.
 */
export function realPath(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    try {
      return realpathSync(path);
    } catch {
      return undefined;
    }
  }
}

/** The real path of a file that may not exist yet: its nearest existing directory made real, the rest as written. */
export function realPathAhead(path: string): string {
  const real = realPath(path);
  if (real !== undefined) {
    return real;
  }
  const parent = dirname(path);
  return parent === path ? path : join(realPathAhead(parent), basename(path));
}

/**
 * A registered path as it is compared: the real path while it exists here, else
 * as written. A path registered before paths were made real (through a symlink,
 * another case on macOS) still matches; one of another machine stays as it is.
 */
export function registeredPath(path: string): string {
  return realPath(path) ?? path;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
