/** Files of the project and of the user's tool directories, by absolute path. */
export interface ProjectFiles {
  /** Content of the file, or undefined if it does not exist. */
  read(path: string): string | undefined;
  isDirectory(path: string): boolean;
  /** Atomic: readers see the old or the new content in full. Creates missing directories. */
  write(path: string, content: string, options?: { readonly executable?: boolean }): void;
  /** Removes the file and up to two parent directories it left empty; a missing file is fine. */
  remove(path: string): void;
  /**
   * Files named one of `names` under `root`, at most `depth` directories deep and
   * `limit` files in total, skipping dependency, build, example and hidden directories.
   */
  find(root: string, names: readonly string[], options: { readonly depth: number; readonly limit: number }): string[];
}
