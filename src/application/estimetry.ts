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
import type { SessionLogReaders } from './contracts/session-logs.js';
import type { LogImportState } from './ports/log-import-state.js';
import { ImportSessionLogs } from './task/import-session-logs.js';
import type { TaskStatusReader } from './ports/task-status-reader.js';
import type { TaskTypeCatalog } from './ports/task-type-catalog.js';
import type { WorkspaceLocator } from './ports/workspace-locator.js';
import { InitProject, type InitInput, type InitReport, type InstallDependencies } from './project/init-project.js';
import { ShowInitChoices, type InitChoices } from './project/show-init-choices.js';
import { ResolveCurrentProject } from './project/resolve-current-project.js';
import { EventMetaSource } from './shared/event-meta-source.js';
import { BindSession } from './task/bind-session.js';
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
import { CloseTask, type CloseTaskInput, type TaskClosedResult } from './task/close-task.js';
import { ShowCloseSummary, type CloseSummary, type CloseSummaryInput } from './task/show-close-summary.js';
import { ShowRenegotiationTarget } from './task/show-renegotiation-target.js';
import { FindRevisionCandidates, type RevisionCandidates, type RevisionCandidatesInput } from './task/find-revision-candidates.js';
import { RepairRevision, type RepairRevisionInput, type RevisionRepaired } from './task/repair-revision.js';
import type { WorkingCopy } from './shared/working-copy.js';
import { CodeVolumeService } from './task/code-volume-service.js';
import { PlanSnapshots } from './task/plan-snapshots.js';
import { Rebuild, type RebuildReport } from './task/rebuild.js';
import { ReviseEstimate, type EstimateRevised, type ReviseEstimateInput } from './task/revise-estimate.js';
import { RecordRetro, type RecordRetroInput, type RetroRecorded } from './task/record-retro.js';
import { Renegotiate, type Renegotiated, type RenegotiateInput } from './task/renegotiate.js';
import { ReopenTask, type TaskReopened } from './task/reopen-task.js';
import type { TaskDetails } from './task/show-task.js';
import { TaskCards } from './task/task-cards.js';
import { TaskClosing } from './task/task-closing.js';
import { FindSimilarTasks, type SimilarTasksInput, type SimilarTasksView } from './task/find-similar-tasks.js';
import { ShowCalibration, type CalibrationInput, type CalibrationView } from './task/show-calibration.js';

/** Everything the application needs from the outside world: the ports, side by side. */
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
  /** Bindings of AI tool sessions, for `emt attach --session` and the closing. */
  readonly sessionBindings: SessionBindings;
  /** Task statuses from snapshots, for `emt attach --session`. */
  readonly taskStatus: TaskStatusReader;
  /** Plans of the flows of a task's projects. */
  readonly plans: Pick<ProjectPlans, 'plans' | 'archives'>;
  readonly cards: CardStore;
  readonly calibration: CalibrationStore;
  readonly calibrationSettings: CalibrationSettings;
  /** Pending proposals to close a task. */
  readonly proposals: CloseProposals;
  /** Code volume at the closing. */
  readonly codeMeasurer: CodeMeasurer;
  readonly gitHead: GitHead;
  /** Where a card newer than this binary, or one that could not be rebuilt, is reported. */
  readonly errors: ErrorReporter;
  /** Session logs of the AI tools, imported into the journal before `task.closed`. */
  readonly logReaders: SessionLogReaders;
  readonly logImportState: LogImportState;
}

type TaskQuery = { readonly task?: TaskId };

/**
 * Single entry point to the application for every client: the CLI now, hooks
 * and an MCP server later. Clients never assemble use cases themselves. The
 * groups follow the stages of `emt --help`; `near` in an input is the working
 * copy the request comes from.
 */
export interface Estimetry {
  readonly project: {
    choices(): InitChoices;
    init(input: InitInput): InitReport;
  };
  readonly tasks: {
    create(input: CreateTaskInput): TaskView;
    start(input: StartTaskInput): TaskView;
    attach(input: AttachTaskInput): AttachTaskResult;
    list(input: { readonly all?: boolean; readonly closed?: boolean }): TaskView[];
    show(input: { readonly task: TaskId }): TaskDetails;
  };
  readonly estimates: {
    save(input: SaveEstimateInput): EstimateSaved;
    revise(input: ReviseEstimateInput): EstimateRevised;
    revisionCandidates(input: RevisionCandidatesInput): RevisionCandidates;
    repairRevision(input: RepairRevisionInput): RevisionRepaired;
    similar(input: SimilarTasksInput): SimilarTasksView;
    calibration(input: CalibrationInput): CalibrationView;
  };
  readonly measuring: {
    status(input: TaskQuery & WorkingCopy): StatusView;
    manual(input: RecordManualTimeInput): ManualTimeRecorded;
    extra(input: RecordExtraInput): ExtraRecorded;
    parallel(input: ChangeParallelModeInput): ParallelModeChanged;
  };
  readonly closing: {
    summary(input: CloseSummaryInput): CloseSummary;
    close(input: CloseTaskInput): TaskClosedResult;
    reopen(input: { readonly task: TaskId }): TaskReopened;
    retro(input: RecordRetroInput): RetroRecorded;
    renegotiationTarget(input: TaskQuery): TaskView;
    renegotiate(input: RenegotiateInput): Renegotiated;
    rebuild(input: TaskQuery): RebuildReport;
  };
}

export function createEstimetry(deps: EstimetryDependencies): Estimetry {
  const core = coreServices(deps);
  return {
    project: projectGroup(deps, core),
    tasks: tasksGroup(deps, core),
    estimates: estimatesGroup(deps, core),
    measuring: measuringGroup(deps, core),
    closing: closingGroup(deps, core),
  };
}

/** Services several groups share: built once per facade. */
interface CoreServices {
  readonly meta: EventMetaSource;
  readonly currentProject: ResolveCurrentProject;
  readonly activeTask: ResolveActiveTask;
  readonly measurement: TaskMeasurement;
  readonly planSnapshots: PlanSnapshots;
  readonly planProgress: TaskPlanProgress;
  readonly taskCards: TaskCards;
  readonly closing: TaskClosing;
}

function coreServices(deps: EstimetryDependencies): CoreServices {
  const currentProject = new ResolveCurrentProject(deps.workspace, deps.projects, deps.projectConfig, deps.authors, deps.clock);
  const measurement = new TaskMeasurement(deps.journal, deps.measurement, deps.clock);
  const importLogs = new ImportSessionLogs({
    readers: deps.logReaders,
    state: deps.logImportState,
    journal: deps.journal,
    ids: deps.ids,
    clock: deps.clock,
    authors: deps.authors,
    errors: deps.errors,
  });
  const planSnapshots = new PlanSnapshots(deps.plans, deps.gitHead, deps.projects);
  const taskCards = new TaskCards(deps.journal, measurement, deps.cards, deps.calibration, deps.calibrationSettings, deps.tasks, deps.errors, deps.authors);
  const closing = new TaskClosing(
    deps.journal,
    new CodeVolumeService(deps.plans, deps.codeMeasurer),
    planSnapshots,
    deps.sessionBindings,
    deps.proposals,
    taskCards,
    deps.clock,
    deps.ids,
    deps.authors,
    () => importLogs,
  );
  return {
    meta: new EventMetaSource(deps.clock, deps.ids, deps.authors),
    currentProject,
    activeTask: new ResolveActiveTask(deps.tasks, currentProject),
    measurement,
    planSnapshots,
    planProgress: new TaskPlanProgress(deps.plans, deps.journal),
    taskCards,
    closing,
  };
}

function projectGroup(deps: EstimetryDependencies, core: CoreServices): Estimetry['project'] {
  const showInitChoices = new ShowInitChoices(deps.workspace, deps.projectConfig, deps.install);
  const initProject = new InitProject(deps.workspace, core.currentProject, deps.projects, deps.projectConfig, deps.install);
  return {
    choices: () => showInitChoices.execute(),
    init: (input) => initProject.execute(input),
  };
}

function tasksGroup(deps: EstimetryDependencies, core: CoreServices): Estimetry['tasks'] {
  const { meta, currentProject, activeTask } = core;
  const createTask = new CreateTask(deps.tasks, currentProject, deps.taskTypes, meta);
  const startTask = new StartTask(deps.tasks, currentProject, activeTask, meta, core.planSnapshots, deps.journal);
  const bindSession = new BindSession(deps.sessionBindings, deps.taskStatus, deps.journal, deps.ids, deps.authors);
  const attachTask = new AttachTask(deps.tasks, currentProject, meta, bindSession, deps.workspace, deps.clock);
  const listTasks = new ListTasks(deps.tasks, currentProject);
  const showTask = new ShowTask(deps.tasks, core.taskCards);
  return {
    create: (input) => createTask.execute(input),
    start: (input) => startTask.execute(input),
    attach: (input) => attachTask.execute(input),
    list: (input) => listTasks.execute(input),
    show: (input) => showTask.execute(input),
  };
}

function estimatesGroup(deps: EstimetryDependencies, core: CoreServices): Estimetry['estimates'] {
  const { meta, currentProject, activeTask, planSnapshots, taskCards } = core;
  const saveEstimate = new SaveEstimate(deps.tasks, activeTask, deps.estimates, deps.taskTypes, meta);
  const reviseEstimate = new ReviseEstimate(
    deps.tasks,
    activeTask,
    deps.estimates,
    deps.taskTypes,
    deps.plans,
    deps.install.files,
    planSnapshots,
    deps.journal,
    deps.proposals,
    meta,
  );
  const findRevisionCandidates = new FindRevisionCandidates(activeTask, meta);
  const repairRevision = new RepairRevision(activeTask, deps.journal, planSnapshots, meta);
  const findSimilar = new FindSimilarTasks(taskCards, currentProject, deps.authors, deps.taskTypes);
  const showCalibration = new ShowCalibration(taskCards, currentProject, deps.authors, deps.taskTypes, deps.calibrationSettings);
  return {
    save: (input) => saveEstimate.execute(input),
    revise: (input) => reviseEstimate.execute(input),
    revisionCandidates: (input) => findRevisionCandidates.execute(input),
    repairRevision: (input) => repairRevision.execute(input),
    similar: (input) => findSimilar.execute(input),
    calibration: (input) => showCalibration.execute(input),
  };
}

function measuringGroup(deps: EstimetryDependencies, core: CoreServices): Estimetry['measuring'] {
  const { meta, activeTask, measurement, planProgress } = core;
  const showStatus = new ShowStatus(activeTask, measurement, planProgress, deps.journal);
  const recordManualTime = new RecordManualTime(deps.tasks, activeTask, measurement, deps.clock, meta);
  const recordExtra = new RecordExtra(deps.tasks, activeTask, meta);
  const changeParallelMode = new ChangeParallelMode(deps.tasks, activeTask, measurement, meta, planProgress);
  return {
    status: (input) => showStatus.execute(input),
    manual: (input) => recordManualTime.execute(input),
    extra: (input) => recordExtra.execute(input),
    parallel: (input) => changeParallelMode.execute(input),
  };
}

function closingGroup(deps: EstimetryDependencies, core: CoreServices): Estimetry['closing'] {
  const { meta, currentProject, activeTask, measurement, taskCards, closing } = core;
  const showCloseSummary = new ShowCloseSummary(activeTask, measurement, core.planSnapshots);
  const closeTask = new CloseTask(deps.tasks, activeTask, measurement, closing, meta);
  const reopenTask = new ReopenTask(deps.tasks, taskCards, deps.proposals, meta);
  const recordRetro = new RecordRetro(deps.tasks, currentProject, taskCards, meta);
  const showRenegotiationTarget = new ShowRenegotiationTarget(activeTask);
  const renegotiate = new Renegotiate(deps.tasks, activeTask, deps.taskTypes, measurement, closing, meta);
  const rebuild = new Rebuild(deps.tasks, taskCards);
  return {
    summary: (input) => showCloseSummary.execute(input),
    close: (input) => closeTask.execute(input),
    reopen: (input) => reopenTask.execute(input),
    retro: (input) => recordRetro.execute(input),
    renegotiationTarget: (input) => showRenegotiationTarget.execute(input),
    renegotiate: (input) => renegotiate.execute(input),
    rebuild: (input) => rebuild.execute(input),
  };
}
