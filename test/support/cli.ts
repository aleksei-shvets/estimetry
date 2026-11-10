import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { tempDir } from './temp-dir.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MAIN = join(ROOT, 'dist', 'bootstrap', 'main.js');

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliSandbox {
  readonly home: string;
  /** HOME of the child processes: Claude Code's personal directory and git's global config live here, not in yours. */
  readonly userHome: string;
  readonly claudeDir: string;
  readonly bin: string;
  /** Runs `emt <args>` in `cwd` against this sandbox's ESTIMETRY_HOME. */
  run(args: readonly string[], cwd: string, bin?: 'emt' | 'estimetry', env?: NodeJS.ProcessEnv): Promise<CliResult>;
  readonly env: NodeJS.ProcessEnv;
  repo(name: string): string;
}

const run = promisify(execFile);

/** A temporary ESTIMETRY_HOME plus `emt` and `estimetry` links to the built CLI. */
export function cliSandbox(): CliSandbox {
  if (!existsSync(MAIN)) {
    throw new Error(`${MAIN} is missing: run "npm run build" first (npm test does it)`);
  }
  // Git hooks run `estimetry` from PATH: a non-executable entry would quietly fall through to a global install.
  accessSync(MAIN, constants.X_OK);
  const root = tempDir('cli-');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  symlinkSync(MAIN, join(bin, 'emt'));
  symlinkSync(MAIN, join(bin, 'estimetry'));
  const userHome = join(root, 'user');
  const claudeDir = join(userHome, '.claude');
  mkdirSync(userHome);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ESTIMETRY_HOME: home,
    HOME: userHome,
    CLAUDE_CONFIG_DIR: claudeDir,
    XDG_CONFIG_HOME: join(userHome, '.config'),
    GIT_CONFIG_GLOBAL: join(userHome, '.gitconfig'),
    PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
  };
  delete env['CI'];

  return {
    home,
    userHome,
    claudeDir,
    bin,
    env,
    async run(args, cwd, name = 'emt', extraEnv = {}) {
      try {
        const { stdout, stderr } = await run(process.execPath, [join(bin, name), ...args], {
          cwd,
          env: { ...env, ...extraEnv },
        });
        return { code: 0, stdout, stderr };
      } catch (error) {
        const failed = error as { code?: number; stdout?: string; stderr?: string };
        return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
      }
    },
    repo(name) {
      const dir = join(root, 'repos', name);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
  };
}

/** Starts `node <args>` and resolves with its exit code; used to run many writers at once. */
export function spawnNode(args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
    child.on('error', reject);
    child.on('exit', (code) => resolvePromise(code ?? -1));
  });
}
