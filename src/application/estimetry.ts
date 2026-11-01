import type { ProjectRepository } from '../domain/project/project-repository.js';
import type { TaskId } from '../domain/task/task-id.js';
import type { TaskRepository } from '../domain/task/task-repository.js';
import type { AuthorProvider } from './ports/author-provider.js';
import type { Clock } from './ports/clock.js';
import type { EstimateReader } from './ports/estimate-reader.js';
import type { EventJournal } from './ports/event-journal.js';
import type { IdGenerator } from './ports/id-generator.js';
import type { MeasurementSettings } from './ports/measurement-settings.js';
import type { ProjectConfigFile } from './ports/project-config-file.js';
import type { SessionBindings } from './ports/session-bindings.js';
import type { TaskStatusReader } from './ports/task-status-reader.js';
import type { TaskTypeCatalog } from './ports/task-type-catalog.js';
import type { WorkspaceLocator } from './ports/workspace-locator.js';
import { InitProject, type InitChoices, type InitInput, type InitReport, type InstallDependencies } from './project/init-project.js';
import { ResolveCurrentProject } from './project/resolve-current-project.js';
import { EventMetaSource } from './shared/event-meta-source.js';
import { BindSession } from './hooks/bind-session.js';
import { AttachTask, type AttachTaskInput, type AttachTaskResult } from './task/attach-task.js';
import { ChangeParallelMode, type ChangeParallelModeInput, type ParallelModeChanged } from './task/change-parallel-mode.js';
import { CreateTask, type CreateTaskInput } from './task/create-task.js';
import { ListTasks } from './task/list-tasks.js';
import { RecordExtra, type ExtraRecorded, type RecordExtraInput } from './task/record-extra.js';
import { RecordManualTime, type ManualTimeRecorded, type RecordManualTimeInput } from './task/record-manual-time.js';
import { ResolveActiveTask } from './task/resolve-active-task.js';
import { SaveEstimate, type EstimateSaved, type SaveEstimateInput } from './task/save-estimate.js';
import { ShowStatus, type StatusView } from './task/show-status.js';
import { ShowTask } from './task/show-task.js';
import { StartTask, type StartTaskInput } from './task/start-task.js';
import { TaskMeasurement } from './task/task-measurement.js';
import { TaskPlanProgress } from './task/task-plan-progress.js';
import type { ProjectPlans } from './ports/project-plans.js';
import type { TaskView } from './task/task-view.js';

/** Everything the application needs from the outside world. */
export interface EstimetryDependencies {
  readonly tasks: TaskRepository;
  readonly projects: ProjectRepository;
  readonly workspace: WorkspaceLocator;
  readonly authors: AuthorProvider;
  readonly taskTypes: TaskTypeCatalog;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly journal: EventJournal;
  readonly measurement: MeasurementSettings;
  readonly estimates: EstimateReader;
  readonly projectConfig: ProjectConfigFile;
  readonly install: InstallDependencies;
  /** Bindings of AI tool sessions, for `emt attach --session`. */
  readonly sessions: { readonly bindings: SessionBindings; readonly tasks: TaskStatusReader };
  /** Plans of the flows of a task's projects, for its progress. */
  readonly plans: Pick<ProjectPlans, 'plans'>;
  /** The directory the command runs in: of several working copies of a project, its plan is read there. */
  readonly workspaceDir?: string;
}

/**
 * Single entry point to the application for every client: the CLI now, hooks
 * and an MCP server later. Clients never assemble use cases themselves.
 */
export interface Estimetry {
  createTask(input: CreateTaskInput): TaskView;
  startTask(input: StartTaskInput): TaskView;
  attachTask(input: AttachTaskInput): AttachTaskResult;
  listTasks(input: { readonly all?: boolean }): TaskView[];
  showTask(input: { readonly task: TaskId }): TaskView;
  saveEstimate(input: SaveEstimateInput): EstimateSaved;
  recordManualTime(input: RecordManualTimeInput): ManualTimeRecorded;
  recordExtra(input: RecordExtraInput): ExtraRecorded;
  changeParallelMode(input: ChangeParallelModeInput): ParallelModeChanged;
  showStatus(input: { readonly task?: TaskId }): StatusView;
  initChoices(): InitChoices;
  initProject(input: InitInput): InitReport;
}

export function createEstimetry(deps: EstimetryDependencies): Estimetry {
  const meta = new EventMetaSource(deps.clock, deps.ids, deps.authors);
  const currentProject = new ResolveCurrentProject(deps.workspace, deps.projects, deps.projectConfig, deps.authors, deps.clock);

  const createTask = new CreateTask(deps.tasks, currentProject, deps.taskTypes, meta);
  const activeTask = new ResolveActiveTask(deps.tasks, currentProject);
  const measurement = new TaskMeasurement(deps.journal, deps.measurement, deps.clock);

  const startTask = new StartTask(deps.tasks, currentProject, activeTask, meta);
  const bindSession = new BindSession(deps.sessions.bindings, deps.sessions.tasks, deps.journal, deps.ids, deps.authors);
  const attachTask = new AttachTask(deps.tasks, currentProject, meta, bindSession, deps.workspace, deps.clock);
  const listTasks = new ListTasks(deps.tasks, currentProject);
  const showTask = new ShowTask(deps.tasks);
  const saveEstimate = new SaveEstimate(deps.tasks, activeTask, deps.estimates, deps.taskTypes, meta);
  const recordManualTime = new RecordManualTime(deps.tasks, activeTask, measurement, deps.clock, meta);
  const recordExtra = new RecordExtra(deps.tasks, activeTask, meta);
  const planProgress = new TaskPlanProgress(deps.plans, deps.journal, deps.workspaceDir);
  const changeParallelMode = new ChangeParallelMode(deps.tasks, activeTask, measurement, meta, planProgress);
  const showStatus = new ShowStatus(activeTask, measurement, planProgress, deps.journal);
  const initProject = new InitProject(deps.workspace, currentProject, deps.projects, deps.projectConfig, deps.install);

  return {
    createTask: (input) => createTask.execute(input),
    startTask: (input) => startTask.execute(input),
    attachTask: (input) => attachTask.execute(input),
    listTasks: (input) => listTasks.execute(input),
    showTask: (input) => showTask.execute(input),
    saveEstimate: (input) => saveEstimate.execute(input),
    recordManualTime: (input) => recordManualTime.execute(input),
    recordExtra: (input) => recordExtra.execute(input),
    changeParallelMode: (input) => changeParallelMode.execute(input),
    showStatus: (input) => showStatus.execute(input),
    initChoices: () => initProject.choices(),
    initProject: (input) => initProject.execute(input),
  };
}
