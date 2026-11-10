import type { SessionLogReader, SessionLogReaders } from '../../application/contracts/session-logs.js';

/** Session log readers by tool id; separate from install and hook code, so each loads only what it needs. */
export class SessionLogReaderRegistry implements SessionLogReaders {
  private readonly readers: SessionLogReader[] = [];

  register(reader: SessionLogReader): this {
    this.readers.push(reader);
    return this;
  }

  get(id: string): SessionLogReader | undefined {
    return this.readers.find((reader) => reader.id === id);
  }
}
