import type { Duration } from '../../domain/measurement/duration.js';
import { Interval } from '../../domain/measurement/interval.js';
import { ManualTime, type ManualTimeKind } from '../../domain/measurement/manual-time.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { Clock } from '../ports/clock.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { retryOnConflict } from '../shared/retry.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { TaskMeasurement } from './task-measurement.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface RecordManualTimeInput {
  readonly task?: TaskId;
  readonly kind: ManualTimeKind;
  readonly duration: Duration;
  readonly description: string;
  /** End of the work; omitted when the user does not know when it happened. */
  readonly at?: Timestamp;
  /** Id of the estimate part the time belongs to. */
  readonly part?: string;
}

export interface ManualTimeRecorded {
  readonly task: TaskView;
  readonly kind: ManualTimeKind;
  readonly minutes: number;
  readonly at?: string;
  readonly description: string;
  readonly part?: string;
  /**
   * The record has no `at`, yet the last `minutes` before now are already measured:
   * the user may be recording time that is counted already.
   */
  readonly overlapsMeasured: boolean;
}

export class RecordManualTime {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activeTask: ResolveActiveTask,
    private readonly measurement: TaskMeasurement,
    private readonly clock: Clock,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: RecordManualTimeInput): ManualTimeRecorded {
    const now = this.clock.now();
    const manual = ManualTime.of(input);
    return retryOnConflict(() => {
      const task = this.activeTask.inProgress(input.task);
      task.recordManualTime(manual, this.meta.next());
      const overlapsMeasured =
        manual.at === undefined &&
        this.measurement.measure(task).measured[manual.kind].overlaps(Interval.endingAt(now, manual.duration));
      this.tasks.save(task);
      const data = manual.toData();
      return {
        task: toTaskView(task),
        kind: data.kind,
        minutes: manual.duration.minutes,
        ...(data.at === undefined ? {} : { at: data.at }),
        ...(data.part === undefined ? {} : { part: data.part }),
        description: data.description,
        overlapsMeasured,
      };
    });
  }
}
