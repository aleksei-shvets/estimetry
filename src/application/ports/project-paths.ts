/** Rules of paths on this platform: separators and absoluteness differ between systems, so they stay behind a port. */
export interface ProjectPaths {
  /** `path` relative to `root` when it lies under it; undefined for the root itself and for paths outside. */
  inside(root: string, path: string): string | undefined;
  /** The path with `/` between its parts, as git patterns take. */
  portable(path: string): string;
  /** True if `path` is `dir` or lies under it. */
  contains(dir: string, path: string): boolean;
  dirname(path: string): string;
  basename(path: string): string;
}
