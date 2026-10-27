import type { ProjectRepository } from '../domain/project/project-repository.js';
import type { TaskId } from '../domain/task/task-id.js';
import type { TaskRepository } from '../domain/task/task-repository.js';
import type { AuthorProvider } from './ports/author-provider.js';
import type { Clock } from './ports/clock.js';
import type { IdGenerator } from './ports/id-generator.js';
import type { TaskTypeCatalog } from './ports/task-type-catalog.js';
import type { WorkspaceLocator } from './ports/workspace-locator.js';
import { ResolveCurrentProject } from './project/resolve-current-project.js';
import { EventMetaSource } from './shared/event-meta-source.js';
import { AttachTask, type AttachTaskResult } from './task/attach-task.js';
import { CreateTask, type CreateTaskInput } from './task/create-task.js';
import { ListTasks } from './task/list-tasks.js';
import { ShowTask } from './task/show-task.js';
import { StartTask } from './task/start-task.js';
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
}

/**
 * Single entry point to the application for every client: the CLI now, hooks
 * and an MCP server later. Clients never assemble use cases themselves.
 */
export interface Estimetry {
  createTask(input: CreateTaskInput): TaskView;
  startTask(input: { readonly task?: TaskId }): TaskView;
  attachTask(input: { readonly task: TaskId }): AttachTaskResult;
  listTasks(input: { readonly all?: boolean }): TaskView[];
  showTask(input: { readonly task: TaskId }): TaskView;
}

export function createEstimetry(deps: EstimetryDependencies): Estimetry {
  const meta = new EventMetaSource(deps.clock, deps.ids, deps.authors);
  const currentProject = new ResolveCurrentProject(deps.workspace, deps.projects, deps.authors, deps.clock);

  const createTask = new CreateTask(deps.tasks, currentProject, deps.taskTypes, meta);
  const startTask = new StartTask(deps.tasks, currentProject, meta);
  const attachTask = new AttachTask(deps.tasks, currentProject, meta);
  const listTasks = new ListTasks(deps.tasks, currentProject);
  const showTask = new ShowTask(deps.tasks);

  return {
    createTask: (input) => createTask.execute(input),
    startTask: (input) => startTask.execute(input),
    attachTask: (input) => attachTask.execute(input),
    listTasks: (input) => listTasks.execute(input),
    showTask: (input) => showTask.execute(input),
  };
}
