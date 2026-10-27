import type { ProjectId } from '../project/project-id.js';
import type { Task } from './task.js';
import type { TaskId } from './task-id.js';

export interface TaskRepository {
  /** Reserves the next free id; two concurrent callers never get the same one. */
  nextId(): TaskId;
  /** @throws TaskNotFound */
  get(id: TaskId): Task;
  find(id: TaskId): Task | undefined;
  /**
   * Persists pending events and the snapshot.
   * @throws ConcurrencyConflict if the stored version differs from `task.loadedVersion`.
   */
  save(task: Task): void;
  listByProject(project: ProjectId): Task[];
  listAll(): Task[];
}
