import type { Timestamp } from '../../domain/shared/timestamp.js';
import { Task } from '../../domain/task/task.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import { TaskType } from '../../domain/task/task-type.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import { closedResult, type TaskClosedResult } from './close-task.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskClosing } from './task-closing.js';
import type { TaskMeasurement } from './task-measurement.js';
import { toTaskView, type TaskView } from './task-view.js';
import type { WorkingCopy } from '../shared/working-copy.js';

export interface RenegotiateInput extends WorkingCopy {
  readonly task?: TaskId;
  /** Title of the new task. */
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  readonly type?: string;
  readonly at?: Timestamp;
}

export interface Renegotiated {
  readonly closed: TaskClosedResult;
  readonly spawned: TaskView;
}

/**
 * `emt renegotiate` (design §3): the extra work becomes a new task with its own
 * estimate, and the original closes as it is. The interface asks first; the
 * new task is created before the original closes, and a retry reuses it.
 */
export class Renegotiate {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activeTask: ResolveActiveTask,
    private readonly taskTypes: TaskTypeCatalog,
    private readonly measurement: TaskMeasurement,
    private readonly closing: TaskClosing,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: RenegotiateInput): Renegotiated {
    const original = this.activeTask.inProgress(input.task);
    original.assertCanClose();
    const spawned = this.spawned(original, input);
    let prepared = false;
    let imported: string[] = [];
    const closed = retryOnConflict(() => {
      const task = this.tasks.get(original.id);
      const meta = this.meta.next();
      task.renegotiate(
        {
          at: input.at ?? meta.at,
          spawned: spawned.id,
          category: input.category ?? 'new-requirement',
          description: input.description?.trim() || input.title,
        },
        { next: () => this.meta.next() },
      );
      if (!prepared) {
        imported = this.closing.prepare(task, meta.at, input);
        prepared = true;
      }
      this.tasks.save(task);
      return task;
    });
    const warnings = [...imported, ...this.closing.finish(closed)];
    return { closed: closedResult(closed, this.measurement, warnings), spawned: toTaskView(spawned) };
  }

  /** A task spawned from the original with this title already exists after a failed attempt. */
  private spawned(original: Task, input: RenegotiateInput): Task {
    const title = input.title.trim();
    const existing = this.tasks
      .listAll()
      .find((task) => task.spawnedFrom?.toString() === original.id.toString() && task.title === title);
    if (existing) {
      return existing;
    }
    const type = input.type === undefined ? original.type : TaskType.of(input.type, this.taskTypes.allowed());
    const task = Task.create(
      { id: this.tasks.nextId(), title, type, project: original.homeProject, spawnedFrom: original.id },
      this.meta.next(),
    );
    this.tasks.save(task);
    return task;
  }
}
