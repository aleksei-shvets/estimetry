/** Archive directories of each project already looked at for a task: a cache the journal can rebuild. */
export interface ProgressSeen {
  readonly directories: Readonly<Record<string, readonly string[]>>;
}

/** The cache `progress/<task>.yaml`; written without a lock, a lost write only repeats a check. */
export interface ProgressState {
  /** Undefined when there is no cache or it cannot be read. */
  read(task: string): ProgressSeen | undefined;
  write(task: string, seen: ProgressSeen): void;
}
