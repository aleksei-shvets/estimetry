/** Size and modification time of a file: a changed fingerprint means new data. */
export interface FileFingerprint {
  readonly size: number;
  readonly mtimeMs: number;
}

export interface SessionLogFingerprint {
  readonly main: FileFingerprint;
  readonly agents: Readonly<Record<string, FileFingerprint>>;
}

/** What the last import of a session's log into one task saw. */
export interface LogImportEntry {
  readonly fingerprint: SessionLogFingerprint;
  /** Byte offset the next import into this task reads from. */
  readonly next: number;
}

/**
 * `log-import/<session>.yaml`: a cache of the imports of a session's log, by
 * task. The records in the journals are the truth; without the cache an import reads the log from the start.
 */
export interface LogImportState {
  /** Runs `work` under the lock of the session's imports: two imports never interleave their records. */
  locked<T>(session: string, work: () => T): T;
  read(session: string): Readonly<Record<string, LogImportEntry>>;
  write(session: string, task: string, entry: LogImportEntry): void;
}
