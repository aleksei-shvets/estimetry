import type { InitReport } from '../../../application/project/init-project.js';
import type { AttachTaskResult } from '../../../application/task/attach-task.js';
import type { ParallelModeChanged } from '../../../application/task/change-parallel-mode.js';
import type { ExtraRecorded } from '../../../application/task/record-extra.js';
import type { ManualTimeRecorded } from '../../../application/task/record-manual-time.js';
import type { EstimateSaved } from '../../../application/task/save-estimate.js';
import type { StatusView } from '../../../application/task/show-status.js';
import type { TaskView } from '../../../application/task/task-view.js';

/** Renders use case results; `--json` picks the JSON presenter instead of branching in commands. */
export interface Presenter {
  taskCreated(task: TaskView): string;
  taskList(tasks: readonly TaskView[], options: { readonly all: boolean }): string;
  taskDetails(task: TaskView): string;
  taskStarted(task: TaskView): string;
  taskAttached(result: AttachTaskResult): string;
  estimateSaved(result: EstimateSaved): string;
  manualTimeRecorded(result: ManualTimeRecorded): string;
  extraRecorded(result: ExtraRecorded): string;
  parallelModeChanged(result: ParallelModeChanged): string;
  status(view: StatusView): string;
  initReport(report: InitReport): string;
}
