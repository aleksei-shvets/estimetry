/** The user's global git excludes, where Claude Code keeps `settings.local.json` out of commits. */
export interface GitExcludes {
  /** Undefined outside a git repository. */
  isIgnored(projectRoot: string, path: string): boolean | undefined;
  /** `core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore`, else `~/.config/git/ignore`. */
  globalFile(): string;
}
