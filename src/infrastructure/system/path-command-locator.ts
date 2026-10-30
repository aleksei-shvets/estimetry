import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { CommandLocator } from '../../application/ports/command-locator.js';

/** Looks through PATH (and PATHEXT on Windows) without starting a process. */
export class PathCommandLocator implements CommandLocator {
  constructor(
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  has(name: string): boolean {
    const dirs = (this.env['PATH'] ?? '').split(delimiter).filter((dir) => dir !== '');
    const extensions = this.platform === 'win32' ? ['', ...(this.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
    return dirs.some((dir) => extensions.some((ext) => isExecutable(join(dir, `${name}${ext}`), this.platform)));
  }
}

function isExecutable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    if (platform !== 'win32') {
      accessSync(path, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}
