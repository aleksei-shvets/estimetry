import type { RetroReason } from '../../domain/task/task-events.js';
import { AmbiguousTask } from '../../domain/task/task-errors.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import { derived } from './reopen-task.js';
import type { TaskCards } from './task-cards.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface RecordRetroInput {
  /** Omitted: the task of the current project closed last. */
  readonly task?: TaskId;
  /** Each may start with `<part id>:`. */
  readonly reasons: readonly string[];
  readonly lesson: string;
}

export interface RetroRecorded {
  readonly task: TaskView;
  readonly reasons: readonly RetroReason[];
  readonly lesson: string;
  readonly warnings: readonly string[];
}

/** `emt retro`: why the fact differs from the estimate, and one lesson (design §5.2). */
export class RecordRetro {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
    private readonly cards: TaskCards,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: RecordRetroInput): RetroRecorded {
    const task = retryOnConflict(() => {
      const task = input.task ? this.tasks.get(input.task) : this.lastClosed();
      task.recordRetro(input.reasons, input.lesson, this.meta.next());
      this.tasks.save(task);
      return task;
    });
    const warnings = derived([
      ['writing the card', () => this.cards.refresh(task)],
      ['updating calibration.json', () => this.cards.recalculate()],
    ]);
    const retro = task.retro;
    return { task: toTaskView(task), reasons: retro?.reasons ?? [], lesson: retro?.lesson ?? '', warnings };
  }

  private lastClosed(): Task {
    const project = this.currentProject.find();
    const closed = (project ? this.tasks.listByProject(project.id) : [])
      .filter((task) => task.status === 'closed')
      .sort((a, b) => (b.closedAt?.toMillis() ?? 0) - (a.closedAt?.toMillis() ?? 0));
    const last = closed[0];
    if (last === undefined) {
      throw new AmbiguousTask('no closed task in this project; close one with `emt close` or pass a task', []);
    }
    return last;
  }
}
