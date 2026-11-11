import type { ErrorReporter } from '../application/ports/error-reporter.js';
import type { AuthorProvider } from '../application/ports/author-provider.js';
import type { EventJournal } from '../application/ports/event-journal.js';
import type { IdGenerator } from '../application/ports/id-generator.js';
import type { MeasurementSettings } from '../application/ports/measurement-settings.js';
import type { ProjectPlans } from '../application/ports/project-plans.js';
import type { ProjectRepository } from '../domain/project/project-repository.js';
import { ActivityRecorder } from '../application/hooks/activity-recorder.js';
import { ChangeCompletions } from '../application/hooks/change-completions.js';
import { CheckpointSnapshot } from '../application/hooks/checkpoint-snapshot.js';
import { Checkpoints } from '../application/hooks/checkpoints.js';
import { CommitRecords, CommitTask } from '../application/hooks/commit-records.js';
import { FlowProjectPlans } from '../application/hooks/flow-plans.js';
import { PendingProposal } from '../application/hooks/pending-proposal.js';
import { ProgressLog } from '../application/hooks/progress-log.js';
import { PromptContext } from '../application/hooks/prompt-context.js';
import { ReceiveHook } from '../application/hooks/receive-hook.js';
import { ReceiveSessionHook } from '../application/hooks/receive-session-hook.js';
import { RecentSessions } from '../application/hooks/recent-sessions.js';
import { SessionEndImport } from '../application/hooks/session-end-import.js';
import { SessionStartContext } from '../application/hooks/session-start-context.js';
import { SessionTask } from '../application/hooks/session-task.js';
import { ChangeArchives } from '../application/shared/change-archives.js';
import { EventMetaSource } from '../application/shared/event-meta-source.js';
import { Timestamp } from '../domain/shared/timestamp.js';
import { FsProjectLocator } from '../infrastructure/fs/fs-project-locator.js';
import { NodeProjectFiles } from '../infrastructure/fs/node-project-files.js';
import type { StorageLayout } from '../infrastructure/fs/storage-layout.js';
import { FsGitHead } from '../infrastructure/git/fs-git-head.js';
import { GitSnapshotsCli } from '../infrastructure/git/git-snapshots.js';
import { FileCloseProposals } from '../infrastructure/persistence/file-close-proposals.js';
import { FileProjectRepository } from '../infrastructure/persistence/file-project-repository.js';
import { FileTaskStatusReader } from '../infrastructure/persistence/file-task-status-reader.js';
import { JsonlEventJournal } from '../infrastructure/persistence/jsonl-event-journal.js';
import { YamlConfigStore } from '../infrastructure/persistence/yaml-config-store.js';
import { YamlProgressState } from '../infrastructure/persistence/yaml-progress-state.js';
import { YamlProjectConfigFile } from '../infrastructure/persistence/yaml-project-config-file.js';
import { YamlCheckpointState, YamlSessionStore } from '../infrastructure/persistence/yaml-session-store.js';
import { RandomIdGenerator } from '../infrastructure/system/random-id-generator.js';
import { noneFlow } from '../integrations/flows/none/none-flow.js';
import { openSpecFlow } from '../integrations/flows/openspec/openspec-flow.js';
import { FlowRegistry } from '../integrations/flows/registry.js';
import { claudeCodeHooks } from '../integrations/tools/claude-code/hook-translation.js';
import { gitHooks } from '../integrations/tools/git/git-hooks.js';
import { HookAdapterRegistry } from '../integrations/tools/hook-adapters.js';

/*
 * The hook receiver, apart from the composition of the facade: the container
 * loads this module only for a hook, and a hook loads nothing of the other
 * commands. What only one kind of call needs loads lazily within it.
 */

/**
 * Only what a hook needs. The author comes from config.yaml alone: detecting it
 * would run git, and init has written the profile already.
 */
export function buildHookReceiver(layout: StorageLayout, errors: ErrorReporter, startedAt: number, claudeConfig: string): ReceiveHook {
  const config = new YamlConfigStore(layout, () => {
    throw new Error(`no author profile in ${layout.configFile}; run estimetry init`);
  });
  const journal = new JsonlEventJournal(layout);
  const ids = new RandomIdGenerator();
  const tasks = new FileTaskStatusReader(layout);
  const bindings = new YamlSessionStore(layout);
  const checkpointState = new YamlCheckpointState(layout);
  const git = new GitSnapshotsCli();
  const started = Timestamp.fromMillis(Math.round(startedAt));
  const files = new NodeProjectFiles();
  const projects = new FileProjectRepository(layout);
  const plans = new FlowProjectPlans(
    new YamlProjectConfigFile(),
    new FlowRegistry().register(openSpecFlow).register(noneFlow),
    files,
    projects,
  );
  const proposals = new FileCloseProposals(layout);
  const clock = { now: () => started };
  const meta = new EventMetaSource(clock, ids, config);
  const locator = new FsProjectLocator(layout);
  const recent = new RecentSessions(checkpointState, config);
  const checkpoints = new Checkpoints(checkpointState, journal, new CheckpointSnapshot(plans, new FsGitHead(), git), config, errors, meta);
  const completions = new ChangeCompletions(
    new ChangeArchives(plans, files),
    new ProgressLog(new YamlProgressState(layout), journal),
    tasks,
    meta,
    errors,
    proposals,
  );
  // Only a pending proposal to close the task needs the plan of the task.
  const proposal = new PendingProposal(proposals, recent, () => hookPlanOf(layout, plans, projects));
  const sessions = new ReceiveSessionHook(
    locator,
    new SessionTask(bindings, tasks, journal, ids, config),
    new ActivityRecorder(journal, bindings, checkpoints, completions, meta),
    // Only the session start needs the fact, and only it loads the task repository and the calculator.
    new SessionStartContext(() => hookFacts(layout, journal, config, plans), checkpoints, proposal),
    new PromptContext(checkpoints, proposal),
    // Only the session end parses a log, and only it loads the reader.
    new SessionEndImport(bindings, tasks, () => hookLogs({ layout, claudeConfig, journal, ids, config, errors })),
  );
  const adapters = new HookAdapterRegistry().register(claudeCodeHooks).register(gitHooks);
  return new ReceiveHook(
    adapters,
    clock,
    new CommitRecords(locator, git, new CommitTask(bindings, tasks, recent), journal, meta),
    sessions,
  );
}

/** The plan of a task for the text of a pending proposal to close it: percent done and unfinished groups. */
async function hookPlanOf(layout: StorageLayout, plans: ProjectPlans, projects: ProjectRepository) {
  const [{ PlanSnapshots }, { SnapshotTaskReader }, { FsGitHead: Head }, { TaskId }] = await Promise.all([
    import('../application/task/plan-snapshots.js'),
    import('../infrastructure/persistence/snapshot-task-reader.js'),
    import('../infrastructure/git/fs-git-head.js'),
    import('../domain/task/task-id.js'),
  ]);
  const snapshots = new PlanSnapshots(plans, new Head(), projects);
  const reader = new SnapshotTaskReader(layout);
  return {
    of: (task: string, near: string) => {
      const found = reader.find(TaskId.parse(task));
      if (found === undefined) {
        return { unfinished: [] };
      }
      const plan = snapshots.closing(found, { near });
      return { ...(plan.done === undefined ? {} : { done: plan.done }), unfinished: plan.unfinishedGroups };
    },
  };
}

/** The fact of a task for the context of a session start. */
async function hookFacts(layout: StorageLayout, journal: EventJournal, settings: MeasurementSettings, plans: ProjectPlans) {
  const [{ MeasuredTaskFacts }, { TaskMeasurement }, { TaskPlanProgress }, { SnapshotTaskReader }, { SystemClock }] = await Promise.all([
    import('../application/hooks/task-facts.js'),
    import('../application/task/task-measurement.js'),
    import('../application/task/task-plan-progress.js'),
    import('../infrastructure/persistence/snapshot-task-reader.js'),
    import('../infrastructure/system/system-clock.js'),
  ]);
  return new MeasuredTaskFacts(
    new SnapshotTaskReader(layout),
    new TaskMeasurement(journal, settings, new SystemClock()),
    new TaskPlanProgress(plans, journal),
  );
}

/** The importer of session logs for a session end. */
async function hookLogs(c: {
  readonly layout: StorageLayout;
  readonly claudeConfig: string;
  readonly journal: EventJournal;
  readonly ids: IdGenerator;
  readonly config: AuthorProvider;
  readonly errors: ErrorReporter;
}) {
  const [{ ImportSessionLogs }, { SessionLogReaderRegistry }, { ClaudeCodeLogs }, { YamlLogImportState }, { SystemClock }] =
    await Promise.all([
      import('../application/task/import-session-logs.js'),
      import('../integrations/tools/session-log-readers.js'),
      import('../integrations/tools/claude-code/importer/claude-code-logs.js'),
      import('../infrastructure/persistence/yaml-log-import-state.js'),
      import('../infrastructure/system/system-clock.js'),
    ]);
  return new ImportSessionLogs({
    readers: new SessionLogReaderRegistry().register(new ClaudeCodeLogs(c.claudeConfig)),
    state: new YamlLogImportState(c.layout),
    journal: c.journal,
    meta: new EventMetaSource(new SystemClock(), c.ids, c.config),
    errors: c.errors,
  });
}
