import type { EventJournal } from '../../src/application/ports/event-journal.js';
import { isProgressRecordType, parseProgressRecord, type ProgressRecord } from '../../src/domain/progress/progress-records.js';
import { parseActivityEvent, type ActivityEvent } from '../../src/domain/measurement/activity-events.js';
import type { Project } from '../../src/domain/project/project.js';
import type { ProjectId } from '../../src/domain/project/project-id.js';
import { ProjectIdTaken, ProjectNotFound, type ProjectRepository } from '../../src/domain/project/project-repository.js';
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

  findById(id: ProjectId): Project | undefined {
    return this.projects.find((project) => project.id.equals(id));
  }

  update(id: ProjectId, change: (project: Project) => Project): Project {
    const index = this.projects.findIndex((project) => project.id.equals(id));
    const current = this.projects[index];
    if (!current) {
      throw new ProjectNotFound(id.value);
    }
    const changed = change(current);
    this.projects[index] = changed;
    return changed;
  }
}

/** Activity events per task, validated on append like the JSONL journal. */
export class InMemoryEventJournal implements EventJournal {
  readonly events = new Map<string, ActivityEvent[]>();
  readonly records = new Map<string, ProgressRecord[]>();
  readonly unassigned = new Map<string, (ActivityEvent | ProgressRecord)[]>();

  append(event: ActivityEvent): void {
    const valid = parseActivityEvent(event);
    this.events.set(valid.task, [...(this.events.get(valid.task) ?? []), valid]);
  }

  readActivity(task: TaskId): ActivityEvent[] {
    return [...(this.events.get(task.toString()) ?? [])];
  }

  appendRecord(record: ProgressRecord): void {
    const valid = parseProgressRecord(record);
    this.records.set(valid.task, [...(this.records.get(valid.task) ?? []), valid]);
  }

  readRecords(task: TaskId): ProgressRecord[] {
    return [...(this.records.get(task.toString()) ?? [])];
  }

  appendUnassigned(project: string, entry: ActivityEvent | ProgressRecord): void {
    const valid = isProgressRecordType(entry.type)
      ? parseProgressRecord(entry, { withoutTask: true })
      : parseActivityEvent(entry, { withoutTask: true });
    this.unassigned.set(project, [...(this.unassigned.get(project) ?? []), valid]);
  }

  readUnassigned(project: string): ActivityEvent[] {
    return (this.unassigned.get(project) ?? []).filter((entry): entry is ActivityEvent => !isProgressRecordType(entry.type));
  }
}
