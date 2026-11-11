import type { Presenter } from './presenter.js';

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** One JSON document per command on stdout, for scripts and agents. */
export const jsonPresenter: Presenter = {
  taskCreated: json,
  taskList: (tasks) => json(tasks),
  taskDetails: json,
  taskStarted: json,
  taskAttached: json,
  estimateSaved: json,
  estimateRevised: json,
  manualTimeRecorded: json,
  extraRecorded: json,
  parallelModeChanged: json,
  status: json,
  initReport: json,
  taskClosed: json,
  taskReopened: json,
  retroRecorded: json,
  renegotiated: json,
  rebuildReport: json,
  similarTasks: json,
  calibration: json,
  closeSummary: json,
};
