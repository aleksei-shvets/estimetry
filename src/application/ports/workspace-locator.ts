/** Locates the working copy the command runs in. */
export interface WorkspaceLocator {
  /** Absolute, symlink-free path of the git root, or of the working directory outside git. */
  currentRoot(): string;
}
