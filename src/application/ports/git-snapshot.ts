import type { FileLines } from '../../domain/progress/progress-records.js';

export interface CommitInfo {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly patchId?: string;
  readonly authoredAt: string;
  readonly committedAt: string;
  readonly files: readonly FileLines[];
}

/** `HEAD` without running git: the hot path of a hook. */
export interface GitHead {
  head(root: string): string | undefined;
}

/** Runs git; only for hooks that run in the background. */
export interface GitSnapshots {
  workingTree(root: string): { readonly files: readonly FileLines[]; readonly untracked: number } | undefined;
  /** The commit `sha`, or `HEAD` without it. */
  commit(root: string, sha?: string): CommitInfo | undefined;
}
