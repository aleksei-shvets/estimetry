import type { PlanStarted } from '../../domain/progress/progress-records.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskRepository } from '../../domain/task/task-repository.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import { CORE_SOURCE, journalEntry } from '../shared/journal-entry.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import type { PlanSnapshots } from './plan-snapshots.js';
import { retryOnConflict } from '../shared/retry.js';
import type { ResolveActiveTask } from './resolve-active-task.js';
import { toTaskView, type TaskView } from './task-view.js';

export interface StartTaskInput {
  /** Omitted: the only startable task of the current project. */
  readonly task?: TaskId;
  /** Backdated start, for work begun before the task was recorded. */
  readonly at?: Timestamp;
}

export class StartTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly currentProject: ResolveCurrentProject,
    private readonly activeTask: ResolveActiveTask,
    private readonly meta: EventMetaSource,
    private readonly plans: PlanSnapshots,
    private readonly journal: Pick<EventJournal, 'appendRecord'>,
    private readonly near: string | undefined,
  ) {}

  execute(input: StartTaskInput): TaskView {
    const task = retryOnConflict(() => {
      const project = this.currentProject.find();
      const task = this.activeTask.toStart(input.task);
      const where = project && task.belongsTo(project.id) ? project.id : task.homeProject;
      task.start(where, this.meta.next(), input.at);
      this.tasks.save(task);
      return task;
    });
    this.recordPlan(task);
    return toTaskView(task);
  }

  /**
   * The plan when work started: the base the card counts closed checkboxes
   * from. Without it the first checkpoint is the base, so a failure here only
   * makes the fact by parts coarser.
   */
  private recordPlan(task: Task): void {
    try {
      const meta = this.meta.next();
      this.journal.appendRecord(
        journalEntry<PlanStarted>(
          'plan.started',
          { source: CORE_SOURCE, projects: this.plans.started(task, this.near, task.startedAt ?? meta.at) },
          { id: meta.id, at: meta.at, author: meta.author, project: task.homeProject.value, task: task.id.toString() },
        ),
      );
    } catch {
      // The base falls back to the first checkpoint.
    }
  }
}
