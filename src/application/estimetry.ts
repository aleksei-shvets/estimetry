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
import type { CalibrationSettings } from './ports/calibration-settings.js';
import type { CalibrationStore } from './ports/calibration-store.js';
import type { CardStore } from './ports/card-store.js';
import type { ErrorReporter } from './ports/error-reporter.js';
import type { CloseProposals } from './ports/close-proposals.js';
import type { CodeMeasurer } from './ports/code-measurer.js';
import type { GitHead } from './ports/git-snapshot.js';
import { CloseTask, type CloseSummary, type CloseTaskInput, type TaskClosedResult } from './task/close-task.js';
import { CodeVolumeService } from './task/code-volume-service.js';
import { PlanSnapshots } from './task/plan-snapshots.js';
import { Rebuild, type RebuildReport } from './task/rebuild.js';
import { ReviseEstimate, type EstimateRevised, type ReviseEstimateInput, type RevisionCandidates } from './task/revise-estimate.js';
import type { Timestamp } from '../domain/shared/timestamp.js';
import { RecordRetro, type RecordRetroInput, type RetroRecorded } from './task/record-retro.js';
import { Renegotiate, type Renegotiated, type RenegotiateInput } from './task/renegotiate.js';
import { ReopenTask, type TaskReopened } from './task/reopen-task.js';
import type { TaskDetails } from './task/show-task.js';
import { TaskCards } from './task/task-cards.js';
import { TaskClosing } from './task/task-closing.js';

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
  readonly plans: Pick<ProjectPlans, 'plans' | 'archives'>;
  /** Closing: cards, calibration, pending proposals and git for the code volume. */
  readonly closing: {
    readonly cards: CardStore;
    readonly calibration: CalibrationStore;
    readonly settings: CalibrationSettings;
    readonly proposals: CloseProposals;
    readonly code: CodeMeasurer;
    readonly head: GitHead;
    /** Where a card newer than this binary, or a card that could not be rebuilt, is reported. */
    readonly errors: ErrorReporter;
  };
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
  listTasks(input: { readonly all?: boolean; readonly closed?: boolean }): TaskView[];
  showTask(input: { readonly task: TaskId }): TaskDetails;
  saveEstimate(input: SaveEstimateInput): EstimateSaved;
  recordManualTime(input: RecordManualTimeInput): ManualTimeRecorded;
  recordExtra(input: RecordExtraInput): ExtraRecorded;
  changeParallelMode(input: ChangeParallelModeInput): ParallelModeChanged;
  showStatus(input: { readonly task?: TaskId }): StatusView;
  closeSummary(input: { readonly task?: TaskId }): CloseSummary;
  closeTask(input: CloseTaskInput): TaskClosedResult;
  reopenTask(input: { readonly task: TaskId }): TaskReopened;
  recordRetro(input: RecordRetroInput): RetroRecorded;
  renegotiationTarget(input: { readonly task?: TaskId }): TaskView;
  renegotiate(input: RenegotiateInput): Renegotiated;
  rebuild(input: { readonly task?: TaskId }): RebuildReport;
  revisionCandidates(input: { readonly task?: TaskId; readonly lostFrom?: Timestamp; readonly spent?: string }): RevisionCandidates;
  reviseEstimate(input: ReviseEstimateInput): EstimateRevised;
  repairRevision(input: { readonly task?: TaskId }): { readonly task: TaskView; readonly revision: string };
  initChoices(): InitChoices;
  initProject(input: InitInput): InitReport;
}

export function createEstimetry(deps: EstimetryDependencies): Estimetry {
  const meta = new EventMetaSource(deps.clock, deps.ids, deps.authors);
  const currentProject = new ResolveCurrentProject(deps.workspace, deps.projects, deps.projectConfig, deps.authors, deps.clock);

  const createTask = new CreateTask(deps.tasks, currentProject, deps.taskTypes, meta);
  const activeTask = new ResolveActiveTask(deps.tasks, currentProject);
  const measurement = new TaskMeasurement(deps.journal, deps.measurement, deps.clock);

  const c = deps.closing;
  const planSnapshots = new PlanSnapshots(deps.plans, c.head, deps.projects);
  const taskCards = new TaskCards(deps.journal, measurement, c.cards, c.calibration, c.settings, deps.tasks, c.errors);
  const closing = new TaskClosing(
    deps.journal,
    new CodeVolumeService(deps.plans, c.code),
    planSnapshots,
    deps.sessions.bindings,
    c.proposals,
    taskCards,
    deps.clock,
    deps.ids,
    deps.authors,
  );
  const startTask = new StartTask(deps.tasks, currentProject, activeTask, meta, planSnapshots, deps.journal, deps.workspaceDir);
  const bindSession = new BindSession(deps.sessions.bindings, deps.sessions.tasks, deps.journal, deps.ids, deps.authors);
  const attachTask = new AttachTask(deps.tasks, currentProject, meta, bindSession, deps.workspace, deps.clock);
  const listTasks = new ListTasks(deps.tasks, currentProject);
  const showTask = new ShowTask(deps.tasks, taskCards);
  const saveEstimate = new SaveEstimate(deps.tasks, activeTask, deps.estimates, deps.taskTypes, meta);
  const recordManualTime = new RecordManualTime(deps.tasks, activeTask, measurement, deps.clock, meta);
  const recordExtra = new RecordExtra(deps.tasks, activeTask, meta);
  const planProgress = new TaskPlanProgress(deps.plans, deps.journal, deps.workspaceDir);
  const changeParallelMode = new ChangeParallelMode(deps.tasks, activeTask, measurement, meta, planProgress);
  const showStatus = new ShowStatus(activeTask, measurement, planProgress, deps.journal);
  const closeTask = new CloseTask(deps.tasks, activeTask, measurement, planSnapshots, closing, meta, deps.workspaceDir);
  const reopenTask = new ReopenTask(deps.tasks, taskCards, c.proposals, meta);
  const recordRetro = new RecordRetro(deps.tasks, currentProject, taskCards, meta);
  const renegotiate = new Renegotiate(deps.tasks, activeTask, deps.taskTypes, measurement, closing, meta, deps.workspaceDir);
  const rebuild = new Rebuild(deps.tasks, taskCards);
  const reviseEstimate = new ReviseEstimate(
    deps.tasks,
    activeTask,
    deps.estimates,
    deps.taskTypes,
    deps.plans,
    deps.install.files,
    planSnapshots,
    deps.journal,
    c.proposals,
    meta,
    deps.workspaceDir,
  );
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
    closeSummary: (input) => closeTask.summary(input),
    closeTask: (input) => closeTask.execute(input),
    reopenTask: (input) => reopenTask.execute(input),
    recordRetro: (input) => recordRetro.execute(input),
    renegotiationTarget: (input) => renegotiate.original(input),
    renegotiate: (input) => renegotiate.execute(input),
    rebuild: (input) => rebuild.execute(input),
    revisionCandidates: (input) => reviseEstimate.candidates(input),
    reviseEstimate: (input) => reviseEstimate.execute(input),
    repairRevision: (input) => reviseEstimate.repair(input),
    initChoices: () => initProject.choices(),
    initProject: (input) => initProject.execute(input),
  };
}
