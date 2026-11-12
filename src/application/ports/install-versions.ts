/**
 * The version of estimetry each working copy was set up by (`init`, `upgrade`),
 * kept in the data directory, not in the project: a shared install is committed.
 * Read by the session start only: one small file.
 */
export interface InstallVersions {
  /** Undefined when the copy was set up before versions were recorded, or never. */
  read(root: string): string | undefined;
  record(root: string, version: string): void;
}
