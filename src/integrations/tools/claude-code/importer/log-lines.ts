import { closeSync, openSync, readSync } from 'node:fs';

/** One complete line of a log file with the byte offset it starts at. */
export interface LogLine {
  readonly offset: number;
  readonly text: string;
}

const CHUNK = 1 << 20;

/**
 * Lines of a file from `from` on, each with its byte offset. A last line
 * without a newline is still being written: it is left for the next read.
 * `stop` is asked between chunks; returning true ends the read early.
 */
export function* logLines(path: string, from: number, stop: () => boolean = () => false): Generator<LogLine, 'done' | 'stopped'> {
  const fd = openSync(path, 'r');
  try {
    let position = from;
    let pending = Buffer.alloc(0);
    let pendingOffset = from;
    const buffer = Buffer.alloc(CHUNK);
    for (;;) {
      if (stop()) {
        return 'stopped';
      }
      const read = readSync(fd, buffer, 0, CHUNK, position);
      if (read === 0) {
        return 'done';
      }
      position += read;
      const chunk = pending.length === 0 ? buffer.subarray(0, read) : Buffer.concat([pending, buffer.subarray(0, read)]);
      let start = 0;
      for (let newline = chunk.indexOf(10, start); newline !== -1; newline = chunk.indexOf(10, start)) {
        yield { offset: pendingOffset + start, text: chunk.toString('utf8', start, newline) };
        start = newline + 1;
      }
      pendingOffset += start;
      pending = Buffer.from(chunk.subarray(start));
    }
  } finally {
    closeSync(fd);
  }
}
