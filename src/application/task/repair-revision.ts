import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import type { WorkingCopy } from '../shared/working-copy.js';
import { writePlanRevised } from './plan-revised.js';
import type { PlanSnapshots } from './plan-snapshots.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
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
    private readonly journal: Pick<EventJournal, 'appendRecord' | 'readRecords'>,
    private readonly snapshots: PlanSnapshots,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: RepairRevisionInput): RevisionRepaired {
    const task = this.activeTask.inProgress(input.task);
    const written = new Set(
      this.journal.readRecords(task.id).flatMap((record) => (record.type === 'plan.revised' ? [record.data.revision] : [])),
    );
    const missing = [...task.revisions].reverse().find((revision) => !written.has(revision.id));
    if (missing === undefined) {
      throw new InvalidValue(`every revision of ${task.id.toString()} has its plan snapshot; nothing to repair`);
    }
    writePlanRevised({ journal: this.journal, snapshots: this.snapshots, meta: this.meta }, task, missing.id, input);
    return { task: toTaskView(task), revision: missing.id };
  }
}
