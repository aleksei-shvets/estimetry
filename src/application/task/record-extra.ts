import type { Duration } from '../../domain/measurement/duration.js';
import { Extra, type ExtraData } from '../../domain/measurement/extra.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import { toTaskView, type TaskView } from './task-view.js';

/** For help texts of the interface. */
export { EXTRA_CATEGORIES } from '../../domain/measurement/extra.js';

export interface RecordExtraInput {
  readonly task?: TaskId;
  /** Checked against the categories by the domain. */
  readonly category: string;
  readonly description: string;
  readonly time?: Duration;
  readonly lines?: number;
  readonly change?: string;
}

export interface ExtraRecorded {
  readonly task: TaskView;
  readonly extra: ExtraData;
}

export class RecordExtra {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activeTask: ResolveActiveTask,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: RecordExtraInput): ExtraRecorded {
    const extra = Extra.of(input);
    return retryOnConflict(() => {
      const task = this.activeTask.inProgress(input.task);
      task.recordExtra(extra, this.meta.next());
      this.tasks.save(task);
      return { task: toTaskView(task), extra: extra.toData() };
    });
  }
}
