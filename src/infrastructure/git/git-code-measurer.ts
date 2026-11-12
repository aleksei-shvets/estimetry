import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthorCommit, CodeMeasurer } from '../../application/ports/code-measurer.js';
import type { FileLines } from '../../domain/progress/progress-records.js';
import { numstat } from './git-snapshots.js';

const MAX_OUTPUT = 256 * 1024 * 1024;
/** Untracked files larger than this are not counted: they are data, not code. */
const MAX_UNTRACKED_BYTES = 1024 * 1024;
const COMMIT_MARK = '\u0001commit ';

/** Git for the code volume of a closing task; runs only in `emt close` and `emt renegotiate`. */
export class GitCodeMeasurer implements CodeMeasurer {
  uncommitted(root: string): FileLines[] | undefined {
    const diff = git(root, ['diff', '--numstat', 'HEAD']);
    if (diff === undefined) {
      return undefined;
    }
    const untracked = (git(root, ['ls-files', '--others', '--exclude-standard', '-z']) ?? '').split('\0').filter((p) => p !== '');
    return [...numstat(diff), ...untracked.flatMap((path) => untrackedLines(root, path))];
  }

  head(root: string): string | undefined {
    return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])?.trim() || undefined;
  }

  reachable(root: string, sha: string): boolean | undefined {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, stdio: 'ignore', windowsHide: true });
      return true;
    } catch (error) {
      // Exit 1: not an ancestor. Anything else (unknown object, no repository): cannot tell.
      return (error as { status?: number }).status === 1 ? false : undefined;
    }
  }

  authorCommits(root: string, base: string): AuthorCommit[] | undefined {
    const email = git(root, ['config', 'user.email'])?.trim();
    if (!email) {
      return undefined;
    }
    const log = git(root, [
      'log',
      '--no-merges',
      '--numstat',
      `--format=${COMMIT_MARK}%H`,
      `--author=<${email}>`,
      `${base}..HEAD`,
    ]);
    if (log === undefined) {
      return undefined;
    }
    return log
      .split(COMMIT_MARK)
      .filter((chunk) => chunk.trim() !== '')
      .map((chunk) => {
        const [sha = '', ...rest] = chunk.split('\n');
        return { sha: sha.trim(), files: numstat(rest.join('\n')) };
      });
  }
}

/** Lines of a new text file; binary and large files count as binary. */
function untrackedLines(root: string, path: string): FileLines[] {
  try {
    const file = join(root, path);
    if (statSync(file).size > MAX_UNTRACKED_BYTES) {
      return [{ path, added: null, deleted: null }];
    }
    const content = readFileSync(file);
    if (content.includes(0)) {
      return [{ path, added: null, deleted: null }];
    }
    const text = content.toString('utf8');
    const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return [{ path, added: lines, deleted: 0 }];
  } catch {
    return [];
  }
}

function git(cwd: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: MAX_OUTPUT,
    });
  } catch {
    return undefined;
  }
}
