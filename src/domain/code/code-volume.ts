import type { CommitRecorded, FileLines, ProjectCode } from '../progress/progress-records.js';
import { classify, type CodeClass } from './code-classes.js';

export interface LineCount {
  readonly added: number;
  readonly deleted: number;
}

/** Lines by class; generated files are only counted. */
export interface CodeLines {
  readonly production: LineCount;
  readonly tests: LineCount;
  readonly config: LineCount;
  readonly docs: LineCount;
  readonly generatedFiles: number;
  readonly binaryFiles: number;
}

/**
 * Recorded commits of a project that count: reachable from `HEAD` (amended and
 * rebased commits are not, and their new versions are recorded too), no
 * merges, one per `patchId`. Without reachability every commit but merges counts.
 */
export function countedCommits(
  commits: readonly CommitRecorded[],
  reachable: ((sha: string) => boolean) | undefined,
): CommitRecorded[] {
  const seen = new Set<string>();
  const counted: CommitRecorded[] = [];
  for (const commit of commits) {
    if (commit.data.parents.length > 1) {
      continue;
    }
    if (reachable !== undefined && !reachable(commit.data.sha)) {
      continue;
    }
    const key = commit.data.patchId ?? commit.data.sha;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    counted.push(commit);
  }
  return counted;
}

/** Lines per path summed over the given file lists; a binary file stays binary. */
export function mergeFiles(lists: readonly (readonly FileLines[])[]): FileLines[] {
  const byPath = new Map<string, FileLines>();
  for (const files of lists) {
    for (const file of files) {
      const known = byPath.get(file.path);
      if (known === undefined) {
        byPath.set(file.path, file);
      } else if (known.added === null || file.added === null) {
        byPath.set(file.path, { path: file.path, added: null, deleted: null });
      } else {
        byPath.set(file.path, {
          path: file.path,
          added: known.added + file.added,
          deleted: (known.deleted ?? 0) + (file.deleted ?? 0),
        });
      }
    }
  }
  return [...byPath.values()];
}

/** Lines of the measured projects by class. */
export function codeLines(projects: readonly ProjectCode[]): CodeLines {
  const lines: Record<Exclude<CodeClass, 'generated'>, { added: number; deleted: number }> = {
    production: { added: 0, deleted: 0 },
    tests: { added: 0, deleted: 0 },
    config: { added: 0, deleted: 0 },
    docs: { added: 0, deleted: 0 },
  };
  let generatedFiles = 0;
  let binaryFiles = 0;
  for (const project of projects) {
    for (const file of project.files) {
      const kind = classify(file.path);
      if (kind === 'generated') {
        generatedFiles += 1;
      } else if (file.added === null || file.deleted === null) {
        binaryFiles += 1;
      } else {
        lines[kind].added += file.added;
        lines[kind].deleted += file.deleted;
      }
    }
  }
  return { ...lines, generatedFiles, binaryFiles };
}
