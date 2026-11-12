import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { GitExcludes } from '../../application/ports/git-excludes.js';

/** Global git excludes, the place Claude Code itself uses to keep `settings.local.json` out of commits. */
export class GitExcludesFile implements GitExcludes {
  constructor(
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly homeDir: string,
  ) {}

  isIgnored(projectRoot: string, path: string): boolean | undefined {
    // check-ignore: 0 — ignored, 1 — not ignored, anything else — not a repository or git missing.
    const result = spawnSync('git', ['check-ignore', '-q', '--no-index', path], {
      cwd: projectRoot,
      stdio: 'ignore',
      windowsHide: true,
      env: this.processEnv(),
    });
    return result.status === 0 ? true : result.status === 1 ? false : undefined;
  }

  globalFile(): string {
    const configured = this.gitConfig('core.excludesFile');
    if (configured !== undefined) {
      return configured.startsWith('~/') ? join(this.homeDir, configured.slice(2)) : configured;
    }
    const xdg = this.env['XDG_CONFIG_HOME'];
    return join(xdg !== undefined && xdg !== '' ? xdg : join(this.homeDir, '.config'), 'git', 'ignore');
  }

  /** Git reads the global excludes through HOME and XDG_CONFIG_HOME of this environment. */
  private processEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.env } as NodeJS.ProcessEnv;
  }

  private gitConfig(key: string): string | undefined {
    try {
      const value = execFileSync('git', ['config', '--global', '--get', key], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        env: this.processEnv(),
      }).trim();
      return value === '' ? undefined : value;
    } catch {
      return undefined;
    }
  }
}
