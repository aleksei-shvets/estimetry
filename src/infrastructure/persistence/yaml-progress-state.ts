import type { ProgressSeen, ProgressState } from '../../application/ports/progress-state.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';

export const PROGRESS_SCHEMA_VERSION = 1;
const TASK_ID = /^T-\d+$/;

/**
 * `progress/<task>.yaml`: a cache, so no lock. Two hooks writing at once lose
 * at most one write, and the next call checks those directories again.
 */
export class YamlProgressState implements ProgressState {
  constructor(private readonly layout: StorageLayout) {}

  read(task: string): ProgressSeen | undefined {
    if (!TASK_ID.test(task)) {
      return undefined;
    }
    let value: unknown;
    try {
      value = readYaml(this.layout.taskProgress(task));
    } catch {
      return undefined; // a broken cache is rebuilt from the journal
    }
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const raw = (value as Record<string, unknown>)['directories'];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return undefined;
    }
    const directories: Record<string, readonly string[]> = {};
    for (const [project, list] of Object.entries(raw)) {
      if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) {
        return undefined;
      }
      directories[project] = list as string[];
    }
    return { directories };
  }

  write(task: string, seen: ProgressSeen): void {
    if (TASK_ID.test(task)) {
      writeYamlAtomic(this.layout.taskProgress(task), { schemaVersion: PROGRESS_SCHEMA_VERSION, directories: seen.directories });
    }
  }
}
