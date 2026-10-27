import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

export interface LockOptions {
  /** How long to wait for a busy lock before giving up. */
  readonly timeoutMs?: number;
  /** A lock older than this is considered abandoned. */
  readonly staleMs?: number;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
export const DEFAULT_LOCK_STALE_MS = 10_000;

export class LockTimeout extends Error {
  constructor(lockFile: string, timeoutMs: number) {
    super(`could not acquire ${lockFile} within ${timeoutMs} ms; if no other estimetry process is running, delete the file`);
    this.name = 'LockTimeout';
  }
}

interface LockOwner {
  readonly pid: number;
  readonly hostname: string;
  readonly at: number;
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));

/**
 * Runs `operation` while holding an exclusive lock file. Used for
 * read-modify-write of YAML files; journal appends do not take it.
 * Synchronous on purpose: hooks and CLI commands are short-lived processes.
 */
export function withFileLock<T>(lockFile: string, operation: () => T, options: LockOptions = {}): T {
  acquire(lockFile, options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, options.staleMs ?? DEFAULT_LOCK_STALE_MS);
  try {
    return operation();
  } finally {
    rmSync(lockFile, { force: true });
  }
}

function acquire(lockFile: string, timeoutMs: number, staleMs: number): void {
  mkdirSync(dirname(lockFile), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (tryCreate(lockFile)) {
      return;
    }
    if (isStale(lockFile, staleMs)) {
      rmSync(lockFile, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new LockTimeout(lockFile, timeoutMs);
    }
    Atomics.wait(sleeper, 0, 0, 5 + Math.floor(Math.random() * 20));
  }
}

function tryCreate(lockFile: string): boolean {
  let fd: number;
  try {
    fd = openSync(lockFile, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
  try {
    const owner: LockOwner = { pid: process.pid, hostname: hostname(), at: Date.now() };
    writeSync(fd, JSON.stringify(owner));
  } finally {
    closeSync(fd);
  }
  return true;
}

function isStale(lockFile: string, staleMs: number): boolean {
  let modifiedAt: number;
  try {
    modifiedAt = statSync(lockFile).mtimeMs;
  } catch {
    return false; // released meanwhile
  }
  let owner: Partial<LockOwner> | undefined;
  try {
    owner = JSON.parse(readFileSync(lockFile, 'utf8')) as Partial<LockOwner>;
  } catch {
    owner = undefined; // the owner has not written its details yet: judge by age only
  }
  const since = typeof owner?.at === 'number' ? owner.at : modifiedAt;
  if (Date.now() - since > staleMs) {
    return true;
  }
  return (
    owner?.hostname === hostname() &&
    typeof owner.pid === 'number' &&
    owner.pid !== process.pid &&
    !isAlive(owner.pid)
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
