import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { ProjectFiles } from '../../application/ports/project-files.js';
import { isNotFound } from './jsonl.js';

/** Directories that never tell the stack of the project itself: dependencies, builds, examples, test data. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'build',
  'dist',
  'target',
  'vendor',
  'Pods',
  'venv',
  'example',
  'examples',
  'samples',
  'fixtures',
  'testdata',
]);

const EMPTY_PARENTS_REMOVED = 2;

export class NodeProjectFiles implements ProjectFiles {
  inside(root: string, path: string): string | undefined {
    const inside = relative(root, path);
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? inside : undefined;
  }

  portable(path: string): string {
    return path.split(sep).join('/');
  }

  contains(dir: string, path: string): boolean {
    return path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
  }

  dirname(path: string): string {
    return dirname(path);
  }

  basename(path: string): string {
    return basename(path);
  }

  read(path: string): string | undefined {
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      if (isNotFound(error) || (error as NodeJS.ErrnoException).code === 'EISDIR') {
        return undefined;
      }
      throw error;
    }
  }

  isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  list(dir: string): string[] {
    try {
      // The type comes with the entry on common file systems: no stat per directory.
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return []; // no such directory: an empty archive, not an error
    }
  }

  changedAt(path: string): number | undefined {
    try {
      return statSync(path).ctimeMs;
    } catch {
      return undefined;
    }
  }

  /** Temp file, fsync, rename: readers see the old or the new content in full. */
  write(path: string, content: string, options: { readonly executable?: boolean } = {}): void {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      const fd = openSync(temp, 'w', options.executable ? 0o755 : 0o644);
      try {
        writeSync(fd, content);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (options.executable) {
        chmodSync(temp, 0o755); // umask may have cut the mode given to open
      } else {
        this.keepMode(path, temp);
      }
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  remove(path: string): void {
    rmSync(path, { force: true });
    // `skills/emt-start/SKILL.md` leaves `skills/emt-start` and maybe `skills` empty; never more, so a root is never at risk.
    let dir = dirname(path);
    for (let level = 0; level < EMPTY_PARENTS_REMOVED; level++) {
      try {
        rmdirSync(dir); // only succeeds when the directory is empty
      } catch {
        return; // not empty or already gone
      }
      dir = dirname(dir);
    }
  }

  find(root: string, names: readonly string[], options: { readonly depth: number; readonly limit: number }): string[] {
    const wanted = new Set(names);
    const found: string[] = [];
    const walk = (dir: string, depth: number): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        return; // unreadable directory
      }
      for (const entry of entries) {
        if (found.length >= options.limit) {
          return;
        }
        if (entry.isFile() && wanted.has(entry.name)) {
          found.push(join(dir, entry.name));
        }
      }
      if (depth >= options.depth) {
        return;
      }
      for (const entry of entries) {
        // Dirent of a symlink is not a directory, so links are never followed.
        if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(join(dir, entry.name), depth + 1);
        }
      }
    };
    walk(root, 0);
    return found;
  }

  /** A rewritten file keeps the mode it had, e.g. an executable git hook stays executable. */
  private keepMode(path: string, temp: string): void {
    try {
      chmodSync(temp, lstatSync(path).mode & 0o777);
    } catch {
      // New file: default mode.
    }
  }
}
