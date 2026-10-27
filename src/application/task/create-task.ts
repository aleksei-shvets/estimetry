import { Task } from '../../domain/task/task.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import { DEFAULT_TASK_TYPE, TaskType } from '../../domain/task/task-type.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface CreateTaskInput {
  readonly title: string;
  readonly type?: string;
  readonly ticket?: string;
}

export class CreateTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
    private readonly taskTypes: TaskTypeCatalog,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: CreateTaskInput): TaskView {
    // Validate before touching storage, so a bad type neither registers a project nor burns an id.
    const type = TaskType.of(input.type ?? DEFAULT_TASK_TYPE, this.taskTypes.allowed());
    const project = this.currentProject.findOrRegister();
    const task = Task.create(
      {
        id: this.tasks.nextId(),
        title: input.title,
        type,
        ...(input.ticket === undefined ? {} : { ticket: input.ticket }),
        project: project.id,
      },
      this.meta.next(),
    );
    this.tasks.save(task);
    return toTaskView(task);
  }
}
