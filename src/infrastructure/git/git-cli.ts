import { execFileSync } from 'node:child_process';
import type { WorkspaceLocator } from '../../application/ports/workspace-locator.js';
import { mainWorktree, realPath } from '../fs/worktree.js';

/** Talks to the `git` executable directly (no shell), so it also works on Windows. */
export class GitCli implements WorkspaceLocator {
  private root: string | undefined;

  constructor(private readonly cwd: string) {}

  currentRoot(): string {
    if (this.root === undefined) {
      const root = this.run(['rev-parse', '--show-toplevel']) ?? this.cwd;
      this.root = realPath(root) ?? root;
    }
    return this.root;
  }

  fingerprint(): string | undefined {
    const roots = this.run(['rev-list', '--max-parents=0', 'HEAD'], this.currentRoot());
    return roots?.split('\n').map((line) => line.trim()).filter((line) => line !== '').sort()[0];
  }

  mainRoot(): string | undefined {
    return mainWorktree(this.currentRoot());
  }

  userEmail(): string | undefined {
    return this.run(['config', 'user.email']);
  }

  /** Output of a git command, or undefined if git is missing or the command fails. */
  private run(args: readonly string[], cwd = this.cwd): string | undefined {
    try {
      const output = execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }).trim();
      return output === '' ? undefined : output;
    } catch {
      return undefined;
    }
  }
}
