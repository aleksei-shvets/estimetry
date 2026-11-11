import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import type { RevisionRecords } from './revision-records.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface RepairRevisionInput extends WorkingCopy {
  readonly task?: TaskId;
}

export interface RevisionRepaired {
  readonly task: TaskView;
  readonly revision: string;
}

/** `emt estimate revise --repair`: the plan snapshot of the last revision that has none, after a failure between the two writes. */
export class RepairRevision {
  constructor(
    private readonly activeTask: ResolveActiveTask,
    private readonly records: Pick<RevisionRecords, 'planRevised' | 'withPlan'>,
  ) {}

  execute(input: RepairRevisionInput): RevisionRepaired {
    const task = this.activeTask.inProgress(input.task);
    const written = this.records.withPlan(task);
    const missing = [...task.revisions].reverse().find((revision) => !written.has(revision.id));
    if (missing === undefined) {
      throw new InvalidValue(`every revision of ${task.id.toString()} has its plan snapshot; nothing to repair`);
    }
    this.records.planRevised(task, missing.id, input);
    return { task: toTaskView(task), revision: missing.id };
  }
}
