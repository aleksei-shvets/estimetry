import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readYaml, writeYamlAtomic } from '../../src/infrastructure/fs/atomic-yaml.js';
import { LockTimeout, withFileLock } from '../../src/infrastructure/fs/file-lock.js';
import { appendJsonLine, LineTooLong, MAX_LINE_BYTES, readJsonLines } from '../../src/infrastructure/fs/jsonl.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { FileErrorReporter } from '../../src/infrastructure/system/file-error-reporter.js';
import { tempDir } from '../support/temp-dir.js';

describe('StorageLayout', () => {
  it('prefers ESTIMETRY_HOME, then XDG_DATA_HOME, then ~/.local/share', () => {
    expect(StorageLayout.resolve({ env: { ESTIMETRY_HOME: '/x', XDG_DATA_HOME: '/d' }, homeDir: '/h' }).root).toBe('/x');
    expect(StorageLayout.resolve({ env: { XDG_DATA_HOME: '/d' }, homeDir: '/h' }).root).toBe(join('/d', 'estimetry'));
    expect(StorageLayout.resolve({ env: { ESTIMETRY_HOME: ' ', XDG_DATA_HOME: '' }, homeDir: '/h' }).root).toBe(
      join('/h', '.local', 'share', 'estimetry'),
    );
  });
});

describe('JSONL journal', () => {
  it('appends whole lines and creates the directory on first write', () => {
    const file = join(tempDir(), 'events', 'T-1.jsonl');
    appendJsonLine(file, { a: 1 });
    appendJsonLine(file, { a: 2 });
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n{"a":2}\n');
    expect(readJsonLines(file)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('rejects a line over the size limit and writes nothing', () => {
    const file = join(tempDir(), 'T-1.jsonl');
    expect(() => appendJsonLine(file, { big: 'x'.repeat(MAX_LINE_BYTES) })).toThrow(LineTooLong);
    expect(existsSync(file)).toBe(false);
  });

  it('skips a torn last line', () => {
    const file = join(tempDir(), 'T-1.jsonl');
    appendJsonLine(file, { a: 1 });
    appendFileSync(file, '{"a":2,"b":');
    expect(readJsonLines(file)).toEqual([{ a: 1 }]);
  });

  it('reads a missing journal as empty', () => {
    expect(readJsonLines(join(tempDir(), 'none.jsonl'))).toEqual([]);
  });
});

describe('atomic YAML', () => {
  it('round-trips and ignores a temp file left by an interrupted write', () => {
    const dir = tempDir();
    const file = join(dir, 'config.yaml');
    writeYamlAtomic(file, { author: { id: 'old' } });
    writeFileSync(join(dir, '.config.yaml.123.abcd.tmp'), 'author: { id: half-writ');
    expect(readYaml(file)).toEqual({ author: { id: 'old' } });
    writeYamlAtomic(file, { author: { id: 'new' } });
    expect(readYaml(file)).toEqual({ author: { id: 'new' } });
  });

  it('reads a missing file as undefined', () => {
    expect(readYaml(join(tempDir(), 'none.yaml'))).toBeUndefined();
  });
});

describe('file lock', () => {
  it('releases the lock after the operation, even on error', () => {
    const lock = join(tempDir(), 'x.lock');
    expect(withFileLock(lock, () => 42)).toBe(42);
    expect(existsSync(lock)).toBe(false);
    expect(() => withFileLock(lock, () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('takes over a lock whose process is gone', () => {
    const lock = join(tempDir(), 'x.lock');
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, hostname: hostname(), at: Date.now() }));
    expect(withFileLock(lock, () => 'ok', { timeoutMs: 200 })).toBe('ok');
  });

  it('takes over a lock older than the stale threshold', () => {
    const lock = join(tempDir(), 'x.lock');
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, hostname: 'elsewhere', at: Date.now() - 60_000 }));
    expect(withFileLock(lock, () => 'ok', { timeoutMs: 200 })).toBe('ok');
  });

  it('gives up on a live lock after the timeout instead of writing without it', () => {
    const lock = join(tempDir(), 'x.lock');
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, hostname: hostname(), at: Date.now() }));
    let ran = false;
    expect(() => withFileLock(lock, () => (ran = true), { timeoutMs: 100 })).toThrow(LockTimeout);
    expect(ran).toBe(false);
  });
});

describe('FileErrorReporter', () => {
  it('records context, message and stack', () => {
    const file = join(tempDir(), 'errors.log');
    new FileErrorReporter(file).report('cli:task new', new Error('boom'));
    const log = readFileSync(file, 'utf8');
    expect(log).toMatch(/\[cli:task new\] Error: boom/);
    expect(log).toMatch(/fs\.test\.ts/);
  });

  it('never throws, even when the log cannot be written', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'errors.log'));
    expect(() => new FileErrorReporter(join(dir, 'errors.log')).report('x', new Error('boom'))).not.toThrow();
  });
});
