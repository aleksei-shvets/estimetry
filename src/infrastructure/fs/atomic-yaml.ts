import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { isNotFound } from './jsonl.js';

export class CorruptFile extends Error {
  constructor(file: string, cause: unknown) {
    super(`cannot parse ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'CorruptFile';
  }
}

/** Temporary files left by an interrupted write; readers skip them. */
export function isTempFile(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.tmp');
}

/**
 * Replaces the file so that readers see either the old or the new content in
 * full: write a sibling temp file, fsync it, rename it over the target.
 */
export function writeYamlAtomic(file: string, data: unknown): void {
  writeTextAtomic(file, stringify(data));
}

/** Any text the same way: temp file, fsync, rename. */
export function writeTextAtomic(file: string, text: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Returns the parsed document, or undefined if the file does not exist. */
export function readYaml(file: string): unknown {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
  try {
    return parse(content) as unknown;
  } catch (error) {
    throw new CorruptFile(file, error);
  }
}
