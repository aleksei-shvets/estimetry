import { execFileSync } from 'node:child_process';
import type { CommitInfo, GitSnapshots } from '../../application/ports/git-snapshot.js';
import type { FileLines } from '../../domain/progress/progress-records.js';

const MAX_OUTPUT = 64 * 1024 * 1024;

/** Runs git without a shell; only background hooks call it, so the agent never waits for it. */
export class GitSnapshotsCli implements GitSnapshots {
  workingTree(root: string): { files: readonly FileLines[]; untracked: number } | undefined {
    const diff = git(root, ['diff', '--numstat', 'HEAD']);
    if (diff === undefined) {
      return undefined;
    }
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard']) ?? '';
    return { files: numstat(diff), untracked: untracked.split('\n').filter((line) => line !== '').length };
  }

  commit(root: string, ref = 'HEAD'): CommitInfo | undefined {
    const shown = git(root, ['show', '--numstat', '--format=%H%x00%P%x00%aI%x00%cI', ref]);
    if (shown === undefined) {
      return undefined;
    }
    const [header = '', ...rest] = shown.split('\n');
    const [sha, parents = '', authoredAt, committedAt] = header.split('\0');
    if (!sha || !authoredAt || !committedAt) {
      return undefined;
    }
    const patch = git(root, ['show', '--format=', ref]);
    const patchId = patch === undefined || patch.trim() === '' ? undefined : git(root, ['patch-id', '--stable'], patch)?.split(' ')[0];
    return {
      sha,
      parents: parents.split(' ').filter((p) => p !== ''),
      ...(patchId ? { patchId } : {}),
      authoredAt: new Date(authoredAt).toISOString(),
      committedAt: new Date(committedAt).toISOString(),
      files: numstat(rest.join('\n')),
    };
  }
}

/** `added<TAB>deleted<TAB>path`; binary files have `-` for both. */
export function numstat(text: string): FileLines[] {
  return text
    .split('\n')
    .map((line) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, added, deleted, path]) => ({
      path: path as string,
      added: added === '-' ? null : Number(added),
      deleted: deleted === '-' ? null : Number(deleted),
    }));
}

function git(cwd: string, args: readonly string[], input?: string): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: MAX_OUTPUT,
      ...(input === undefined ? {} : { input }),
    });
  } catch {
    return undefined;
  }
}
