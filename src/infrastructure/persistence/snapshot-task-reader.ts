import { readYaml } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { Task } from '../../domain/task/task.js';
import type { TaskId } from '../../domain/task/task-id.js';
import { parseTaskSnapshot } from './records.js';

/**
 * A task from its snapshot alone, without reading its journal to check it:
 * the session start of a hook reads the journal once already for the fact.
 */
export class SnapshotTaskReader {
  constructor(private readonly layout: StorageLayout) {}

  find(id: TaskId): Task | undefined {
    try {
      const snapshot = parseTaskSnapshot(readYaml(this.layout.taskSnapshot(id.toString())));
      return snapshot ? Task.rehydrate(snapshot) : undefined;
    } catch {
      return undefined;
    }
  }
}
