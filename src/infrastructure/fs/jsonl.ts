import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Keeps every append a single small write, which O_APPEND does not interleave on local filesystems. */
export const MAX_LINE_BYTES = 64 * 1024;

export class LineTooLong extends Error {
  constructor(file: string, bytes: number) {
    super(`refusing to append ${bytes} bytes to ${file}: a journal line must not exceed ${MAX_LINE_BYTES} bytes`);
    this.name = 'LineTooLong';
  }
}

/** Appends one record as one complete line. Journals are append-only. */
export function appendJsonLine(file: string, record: unknown): void {
  const line = `${JSON.stringify(record)}\n`;
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > MAX_LINE_BYTES) {
    throw new LineTooLong(file, bytes);
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, line, { encoding: 'utf8', flag: 'a' });
}

/** Reads all parsable lines; a torn or garbled line is skipped, not fatal. */
export function readJsonLines(file: string): unknown[] {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  const records: unknown[] = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch {
      // A crash mid-write leaves a partial last line; everything before it is still valid.
    }
  }
  return records;
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
