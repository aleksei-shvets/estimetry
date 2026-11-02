import type { FileLines } from '../../domain/progress/progress-records.js';

export interface AuthorCommit {
  readonly sha: string;
  readonly files: readonly FileLines[];
}

/** What the code volume of a closing task needs from git, in a working copy. Undefined: git could not tell. */
export interface CodeMeasurer {
  /** Uncommitted changes against `HEAD` plus new untracked files (by their lines). */
  uncommitted(root: string): FileLines[] | undefined;
  head(root: string): string | undefined;
  /** Whether `sha` is an ancestor of `HEAD` (or `HEAD` itself). */
  reachable(root: string, sha: string): boolean | undefined;
  /** Commits between `base` and `HEAD` by the user of `git config user.email`, without merges. */
  authorCommits(root: string, base: string): AuthorCommit[] | undefined;
}
