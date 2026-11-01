import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { GitHead } from '../../application/ports/git-snapshot.js';

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * `HEAD` from the files of `.git`, without running git: a ref file, then
 * `packed-refs`, a detached `HEAD`, and worktrees whose refs live in the common
 * directory. The reftable format is not read; then there is no head.
 */
export class FsGitHead implements GitHead {
  head(root: string): string | undefined {
    try {
      const gitDir = this.gitDir(root);
      const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
      if (SHA.test(head)) {
        return head;
      }
      const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
      if (ref === undefined) {
        return undefined;
      }
      const common = this.commonDir(gitDir);
      return this.looseRef(gitDir, ref) ?? this.looseRef(common, ref) ?? this.packedRef(common, ref);
    } catch {
      return undefined;
    }
  }

  private gitDir(root: string): string {
    const dotGit = join(root, '.git');
    if (statSync(dotGit).isDirectory()) {
      return dotGit;
    }
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim() ?? '';
    return isAbsolute(gitdir) ? gitdir : resolve(root, gitdir);
  }

  private commonDir(gitDir: string): string {
    try {
      const common = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
      return isAbsolute(common) ? common : resolve(gitDir, common);
    } catch {
      return gitDir;
    }
  }

  private looseRef(dir: string, ref: string): string | undefined {
    try {
      const sha = readFileSync(join(dir, ref), 'utf8').trim();
      return SHA.test(sha) ? sha : undefined;
    } catch {
      return undefined;
    }
  }

  private packedRef(dir: string, ref: string): string | undefined {
    try {
      for (const line of readFileSync(join(dir, 'packed-refs'), 'utf8').split('\n')) {
        const [sha, name] = line.trim().split(' ');
        if (name === ref && sha !== undefined && SHA.test(sha)) {
          return sha;
        }
      }
    } catch {
      // No packed refs.
    }
    return undefined;
  }
}
