/** Locates the working copy the command runs in. */
export interface WorkspaceLocator {
  /** Absolute, symlink-free path of the git root, or of the working directory outside git. */
  currentRoot(): string;
  /** Smallest root commit of the repository; undefined outside git or before the first commit. */
  fingerprint(): string | undefined;
}
