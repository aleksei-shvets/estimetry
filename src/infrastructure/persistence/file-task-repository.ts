import { closeSync, mkdirSync, openSync, readdirSync } from 'node:fs';
import type { ProjectId } from '../../domain/project/project-id.js';
import { Task, TASK_SNAPSHOT_SCHEMA_VERSION } from '../../domain/task/task.js';
import { ConcurrencyConflict, JournalTooNew, TaskNotFound } from '../../domain/task/task-errors.js';
import type { TaskEvent } from '../../domain/task/task-events.js';
import { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import { appendJsonLine, isNotFound, readJsonLines } from '../fs/jsonl.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { parseTaskEvent, parseTaskSnapshot } from './records.js';

/**
 * Tasks on disk: `events/<id>.jsonl` is the source of truth, `tasks/<id>.yaml`
 * is a snapshot carrying `version` and `lastEventId`. A snapshot that disagrees
 * with the journal (a crash between the two writes) is rebuilt on read.
 */
export class FileTaskRepository implements TaskRepository {
  constructor(private readonly layout: StorageLayout) {}

  nextId(): TaskId {
    return withFileLock(this.layout.taskIdLock, () => {
      const id = TaskId.fromNumber(this.highestNumber() + 1);
      // An empty journal reserves the number before the snapshot exists.
      mkdirSync(this.layout.eventsDir, { recursive: true });
      closeSync(openSync(this.layout.taskJournal(id.toString()), 'wx'));
      return id;
    });
  }

  get(id: TaskId): Task {
    const task = this.find(id);
    if (!task) {
      throw new TaskNotFound(id.toString());
    }
    return task;
  }

  find(id: TaskId): Task | undefined {
    const events = this.readEvents(id.toString());
    if (events.length === 0) {
      return undefined;
    }
    const snapshot = parseTaskSnapshot(readYaml(this.layout.taskSnapshot(id.toString())));
    if (snapshot && snapshot.schemaVersion > TASK_SNAPSHOT_SCHEMA_VERSION) {
      throw new JournalTooNew(id.toString(), `snapshot version ${snapshot.schemaVersion}`);
    }
    // A snapshot of an older schema lacks fields the journal has: it is rebuilt.
    if (
      snapshot &&
      snapshot.schemaVersion === TASK_SNAPSHOT_SCHEMA_VERSION &&
      snapshot.version === events.length &&
      snapshot.lastEventId === events.at(-1)?.id
    ) {
      return Task.rehydrate(snapshot);
    }
    return this.rebuildById(id.toString());
  }

  ids(): TaskId[] {
    const ids = new Set([...this.taskFiles(this.layout.eventsDir, '.jsonl'), ...this.taskFiles(this.layout.tasksDir, '.yaml')]);
    return [...ids].map((id) => TaskId.parse(id)).sort((a, b) => a.number - b.number);
  }

  rebuild(id: TaskId): Task | undefined {
    return this.rebuildById(id.toString());
  }

  save(task: Task): void {
    const id = task.id.toString();
    withFileLock(this.layout.taskLock(id), () => {
      const stored = this.readEvents(id).length;
      if (stored !== task.loadedVersion) {
        throw new ConcurrencyConflict(id, task.loadedVersion, stored);
      }
      for (const event of task.pullEvents()) {
        appendJsonLine(this.layout.taskJournal(id), event);
      }
      writeYamlAtomic(this.layout.taskSnapshot(id), task.toSnapshot());
    });
  }

  listByProject(project: ProjectId): Task[] {
    return this.listAll().filter((task) => task.belongsTo(project));
  }

  /**
   * Reads snapshots only, so listing stays cheap however long the journals grow.
   * A journal without a snapshot (crash right after the first append) is rebuilt.
   */
  listAll(): Task[] {
    const snapshots = new Set(this.taskFiles(this.layout.tasksDir, '.yaml'));
    const tasks: Task[] = [];
    for (const id of this.taskFiles(this.layout.eventsDir, '.jsonl')) {
      const snapshot = snapshots.has(id) ? parseTaskSnapshot(readYaml(this.layout.taskSnapshot(id))) : undefined;
      try {
        // Lists read snapshots only, of any schema: a task is read in full (and rebuilt or refused) when it is opened.
        const task = snapshot ? Task.rehydrate(snapshot) : this.find(TaskId.parse(id));
        if (task) {
          tasks.push(task);
        }
      } catch (error) {
        // A task written by a newer estimetry is left out of lists; reading it alone names the problem.
        if (!(error instanceof JournalTooNew)) {
          throw error;
        }
      }
    }
    return tasks.sort((a, b) => a.id.number - b.id.number);
  }

  private rebuildById(id: string): Task | undefined {
    return withFileLock(this.layout.taskLock(id), () => {
      const events = this.readEvents(id);
      if (events.length === 0) {
        return undefined;
      }
      const task = Task.fromEvents(events);
      writeYamlAtomic(this.layout.taskSnapshot(id), task.toSnapshot());
      return task;
    });
  }

  /** Events of the task aggregate; other records in the journal belong to later features. */
  private readEvents(id: string): TaskEvent[] {
    return readJsonLines(this.layout.taskJournal(id))
      .map(parseTaskEvent)
      .filter((event) => event !== undefined);
  }

  private highestNumber(): number {
    const numbers = [
      ...this.taskFiles(this.layout.tasksDir, '.yaml'),
      ...this.taskFiles(this.layout.eventsDir, '.jsonl'),
    ].map((id) => TaskId.parse(id).number);
    return Math.max(0, ...numbers);
  }

  /** Task ids that have a file with the given extension in `dir`. */
  private taskFiles(dir: string, extension: string): string[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
    return names
      .filter((name) => name.endsWith(extension))
      .map((name) => name.slice(0, -extension.length))
      .filter((id) => TaskId.tryNumber(id) !== undefined);
  }
}
