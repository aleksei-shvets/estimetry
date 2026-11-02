import type { InitReport } from '../../../application/project/init-project.js';
import type { AttachTaskResult } from '../../../application/task/attach-task.js';
import type { ParallelModeChanged } from '../../../application/task/change-parallel-mode.js';
import type { ExtraRecorded } from '../../../application/task/record-extra.js';
import type { ManualTimeRecorded } from '../../../application/task/record-manual-time.js';
import type { EstimateSaved } from '../../../application/task/save-estimate.js';
import type { EstimateRevised } from '../../../application/task/revise-estimate.js';
import type { StatusView } from '../../../application/task/show-status.js';
import type { TaskView } from '../../../application/task/task-view.js';
import type { TaskClosedResult } from '../../../application/task/close-task.js';
import type { RebuildReport } from '../../../application/task/rebuild.js';
import type { RetroRecorded } from '../../../application/task/record-retro.js';
import type { Renegotiated } from '../../../application/task/renegotiate.js';
import type { TaskReopened } from '../../../application/task/reopen-task.js';
import type { TaskDetails } from '../../../application/task/show-task.js';

/** Renders use case results; `--json` picks the JSON presenter instead of branching in commands. */
export interface Presenter {
  taskCreated(task: TaskView): string;
  taskList(tasks: readonly TaskView[], options: { readonly all: boolean }): string;
  taskDetails(task: TaskDetails): string;
  taskStarted(task: TaskView): string;
  taskAttached(result: AttachTaskResult): string;
  estimateSaved(result: EstimateSaved): string;
  estimateRevised(result: EstimateRevised): string;
  manualTimeRecorded(result: ManualTimeRecorded): string;
  extraRecorded(result: ExtraRecorded): string;
  parallelModeChanged(result: ParallelModeChanged): string;
  status(view: StatusView): string;
  initReport(report: InitReport): string;
  taskClosed(result: TaskClosedResult): string;
  taskReopened(result: TaskReopened): string;
  retroRecorded(result: RetroRecorded): string;
  renegotiated(result: Renegotiated): string;
  rebuildReport(report: RebuildReport): string;
}
