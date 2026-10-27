import type { TaskView } from '../../../application/task/task-view.js';
import type { Presenter } from './presenter.js';

export const textPresenter: Presenter = {
  taskCreated: (task) => `Created ${task.id} "${task.title}" (${task.type}) in project ${task.projects.join(', ')}`,

  taskList: (tasks, { all }) => {
    if (tasks.length === 0) {
      return all ? 'No tasks yet.' : 'No tasks in this project. Use --all to see every project.';
    }
    const rows = tasks.map((task) => [
      task.id,
      task.status,
      task.type,
      ...(all ? [task.projects.join(',')] : []),
      task.title,
    ]);
    return table(rows);
  },

  taskDetails: (task) =>
    table(
      [
        ['id', task.id],
        ['title', task.title],
        ['type', task.type],
        ['ticket', task.ticket],
        ['status', task.status],
        ['estimated', task.estimated ? 'yes' : 'no'],
        ['projects', task.projects.join(', ')],
        ['author', task.author],
        ['created', task.createdAt],
        ['started', task.startedAt],
      ].filter((row): row is [string, string] => row[1] !== undefined),
    ),

  taskStarted: (task) => `Started ${task.id} "${task.title}"`,

  taskAttached: ({ task, project, attached }) =>
    attached ? `Attached ${task.id} to project ${project}` : `${task.id} is already attached to project ${project}`,
};

/** Warning shown when work starts without an estimate. */
export function unestimatedWarning(task: TaskView): string {
  return `warning: ${task.id} has no estimate, so it will not be used for calibration`;
}

function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  }
  return rows
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  '))
    .join('\n');
}
