import type { Project } from '../../src/domain/project/project.js';
import type { ProjectId } from '../../src/domain/project/project-id.js';
import { ProjectIdTaken, type ProjectRepository } from '../../src/domain/project/project-repository.js';
import { Task } from '../../src/domain/task/task.js';
import { ConcurrencyConflict, TaskNotFound } from '../../src/domain/task/task-errors.js';
import type { TaskEvent } from '../../src/domain/task/task-events.js';
import { TaskId } from '../../src/domain/task/task-id.js';
import type { TaskRepository } from '../../src/domain/task/task-repository.js';

/** Keeps journals in memory with the same version semantics as the file repository. */
export class InMemoryTaskRepository implements TaskRepository {
  private last = 0;
  readonly journals = new Map<string, TaskEvent[]>();
  /** Runs right before a save is checked; lets tests simulate a concurrent writer. */
  beforeSave: ((task: Task) => void) | undefined;

  nextId(): TaskId {
    this.last += 1;
    return TaskId.fromNumber(this.last);
  }

  get(id: TaskId): Task {
    const task = this.find(id);
    if (!task) {
      throw new TaskNotFound(id.toString());
    }
    return task;
  }

  find(id: TaskId): Task | undefined {
    const events = this.journals.get(id.toString());
    return events && events.length > 0 ? Task.fromEvents(events) : undefined;
  }

  save(task: Task): void {
    const hook = this.beforeSave;
    this.beforeSave = undefined;
    hook?.(task);
    const journal = this.journals.get(task.id.toString()) ?? [];
    if (journal.length !== task.loadedVersion) {
      throw new ConcurrencyConflict(task.id.toString(), task.loadedVersion, journal.length);
    }
    this.journals.set(task.id.toString(), [...journal, ...task.pullEvents()]);
  }

  listByProject(project: ProjectId): Task[] {
    return this.listAll().filter((task) => task.belongsTo(project));
  }

  listAll(): Task[] {
    return [...this.journals.values()].filter((events) => events.length > 0).map((events) => Task.fromEvents(events));
  }
}

export class InMemoryProjectRepository implements ProjectRepository {
  readonly projects: Project[] = [];

  findByPath(path: string): Project | undefined {
    return this.projects.find((project) => project.hasPath(path));
  }

  ids(): ReadonlySet<string> {
    return new Set(this.projects.map((project) => project.id.value));
  }

  addIfAbsent(project: Project): Project {
    const owner = project.paths.map((path) => this.findByPath(path)).find((found) => found !== undefined);
    if (owner) {
      return owner;
    }
    if (this.ids().has(project.id.value)) {
      throw new ProjectIdTaken(project.id.value);
    }
    this.projects.push(project);
    return project;
  }
}
