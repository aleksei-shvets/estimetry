/** Reads one kind of manifest and returns stack tags in kebab-case. */
export interface StackDetector {
  /** File names this detector reads, e.g. `package.json`. */
  readonly manifests: readonly string[];
  /** Files that only matter next to a manifest, e.g. `tsconfig.json` beside `package.json`. */
  readonly companions?: readonly string[];
  /**
   * `siblings` are the names of the other files found in the same directory.
   * Throws when the manifest cannot be parsed; the caller turns that into a warning.
   */
  detect(name: string, content: string, siblings: ReadonlySet<string>): readonly string[];
}
