import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { WorkspaceLocator } from '../../application/ports/workspace-locator.js';

/** Talks to the `git` executable directly (no shell), so it also works on Windows. */
export class GitCli implements WorkspaceLocator {
  private root: string | undefined;

  constructor(private readonly cwd: string) {}

  currentRoot(): string {
    this.root ??= realpathSync(this.run(['rev-parse', '--show-toplevel']) ?? this.cwd);
    return this.root;
  }

  userEmail(): string | undefined {
    return this.run(['config', 'user.email']);
  }

  /** Output of a git command, or undefined if git is missing or the command fails. */
  private run(args: readonly string[]): string | undefined {
    try {
      const output = execFileSync('git', args, {
        cwd: this.cwd,
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
