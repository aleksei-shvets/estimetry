import type { PartKind } from '../../domain/estimate/part-kind.js';
import type { ThreePointData } from '../../domain/estimate/three-point-estimate.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import { TaskType } from '../../domain/task/task-type.js';
import type { EstimateReader } from '../ports/estimate-reader.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface SaveEstimateInput {
  readonly file: string;
  /** Omitted: the only task of the current project that is new or estimated. */
  readonly task?: TaskId;
}

export interface EstimateSaved {
  readonly task: TaskView;
  /** Hours summed over parts. */
  readonly total: ThreePointData;
  readonly parts: number;
  /** Testing kinds the plan has no part for; the CLI warns about them. */
  readonly missingKinds: readonly PartKind[];
}

const TESTING_KINDS: readonly PartKind[] = ['auto-tests', 'manual-testing'];

export class SaveEstimate {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activeTask: ResolveActiveTask,
    private readonly reader: EstimateReader,
    private readonly taskTypes: TaskTypeCatalog,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: SaveEstimateInput): EstimateSaved {
    // A broken file fails before any task is looked up.
    const estimate = this.reader.read(input.file);
    const type = estimate.type === undefined ? undefined : TaskType.of(estimate.type, this.taskTypes.allowed());
    return retryOnConflict(() => {
      const task = this.activeTask.toEstimate(input.task);
      task.saveEstimate(estimate, type, this.meta.next());
      this.tasks.save(task);
      return {
        task: toTaskView(task),
        total: estimate.total.toData(),
        parts: estimate.parts.length,
        missingKinds: TESTING_KINDS.filter((kind) => !estimate.hasKind(kind)),
      };
    });
  }
}
