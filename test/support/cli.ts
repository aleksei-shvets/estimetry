import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  /** Runs `emt <args>` in `cwd` against this sandbox's ESTIMETRY_HOME. */
  run(args: readonly string[], cwd: string, bin?: 'emt' | 'estimetry'): Promise<CliResult>;
  repo(name: string): string;
}

const run = promisify(execFile);

/** A temporary ESTIMETRY_HOME plus `emt` and `estimetry` links to the built CLI. */
export function cliSandbox(): CliSandbox {
  if (!existsSync(MAIN)) {
    throw new Error(`${MAIN} is missing: run "npm run build" first (npm test does it)`);
  }
  const root = tempDir('cli-');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  symlinkSync(MAIN, join(bin, 'emt'));
  symlinkSync(MAIN, join(bin, 'estimetry'));

  return {
    home,
    async run(args, cwd, name = 'emt') {
      try {
        const { stdout, stderr } = await run(process.execPath, [join(bin, name), ...args], {
          cwd,
          env: { ...process.env, ESTIMETRY_HOME: home },
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
