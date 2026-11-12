/** Locates the working copy the command runs in. */
export interface WorkspaceLocator {
  /** Absolute, symlink-free path of the git root, or of the working directory outside git. */
  currentRoot(): string;
  /** Smallest root commit of the repository; undefined outside git or before the first commit. */
  fingerprint(): string | undefined;
  /** The main working copy when the current root is a linked git worktree; undefined for the main copy and outside git. */
  mainRoot(): string | undefined;
}
