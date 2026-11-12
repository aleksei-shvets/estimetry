/**
 * How this installation of estimetry is started: node, the entry point and the
 * data directory. Written into the hooks `init` installs, so a hook runs this
 * installation whatever node a version manager (asdf, nvm) picks for the project
 * and whatever PATH the program that runs the hook has (an IDE started from the Dock).
 */
export interface EstimetryRunner {
  readonly node: string;
  readonly main: string;
  readonly home: string;
}

/** This installation: its version (stamped into generated files) and how it is started, when known. */
export interface Installation {
  readonly version: string;
  /** Unknown for a run from the cache of `npx`: hooks then call `estimetry` from PATH. */
  readonly runner?: EstimetryRunner;
}
