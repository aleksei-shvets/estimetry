import type { StatusView } from '../../../application/task/show-status.js';
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
        ['created', localTime(task.createdAt)],
        ['started', task.startedAt === undefined ? undefined : localTime(task.startedAt)],
      ].filter((row): row is [string, string] => row[1] !== undefined),
    ),

  taskStarted: (task) => `Started ${task.id} "${task.title}"`,

  taskAttached: ({ task, project, attached }) =>
    attached ? `Attached ${task.id} to project ${project}` : `${task.id} is already attached to project ${project}`,

  estimateSaved: ({ task, total, parts }) =>
    `Estimate saved for ${task.id}: ${total.optimistic} / ${total.likely} / ${total.pessimistic} h, ${parts} part${parts === 1 ? '' : 's'}`,

  manualTimeRecorded: ({ task, kind, minutes, at, description }) =>
    `Recorded ${formatMinutes(minutes)} of ${kind === 'agent' ? 'agent' : 'user'} time for ${task.id}` +
    `${at === undefined ? '' : ` ending ${localTime(at)}`}: ${description}`,

  extraRecorded: ({ task, extra }) => {
    const details = [
      extra.category,
      extra.accounting,
      ...(extra.timeMs === undefined ? [] : [formatMinutes(extra.timeMs / 60_000)]),
      ...(extra.lines === undefined ? [] : [`${extra.lines} lines`]),
      ...(extra.change === undefined ? [] : [extra.change]),
    ];
    return `Recorded extra work for ${task.id} (${details.join(', ')}): ${extra.description}`;
  },

  parallelModeChanged: ({ task, enabled, budgetShare }) =>
    enabled
      ? `Parallel mode on for ${task.id}${budgetShare === undefined ? '' : ` (${percent(budgetShare)} of the budget spent)`}`
      : `Parallel mode off for ${task.id}`,

  status: (view) => statusText(view),
};

/** `1h 40m`, `9h`, `25m`; zero is `0m`. */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function statusText(view: StatusView): string {
  const estimate =
    view.estimate === null
      ? ' (no estimate)'
      : ` of ${formatMinutes(view.estimate.likely * 60)}${view.estimateShare === null ? '' : ` (${percent(view.estimateShare)})`}`;
  const uncertainty =
    `± ${formatMinutes(view.uncertainty)}` +
    (view.uncertaintyShare === null ? '' : ` (${percent(view.uncertaintyShare)})`) +
    (view.uncertaintyExceedsTarget ? ', above the 5% target' : '');
  const extras = Object.entries(view.records.extraMinutesByCategory).map(
    ([category, minutes]) => `${category} ${formatMinutes(minutes)}`,
  );
  const rows: [string, string][] = [
    ['fact', `${formatMinutes(view.fact)}${estimate}`],
    ['  agents', formatMinutes(view.agentTime)],
    ['  user', formatMinutes(view.userTime)],
    ['uncertainty', uncertainty],
    ['manual', `${formatMinutes(view.manualTime)}${view.manualShare === null ? '' : ` (${percent(view.manualShare)} of fact)`}`],
    ['agent work', formatMinutes(view.agentWork)],
    ['calendar', formatMinutes(view.calendar)],
  ];
  if (view.parallel.used) {
    rows.push([
      'parallel',
      `${view.parallel.maxAgents === null ? 'yes' : `${view.parallel.maxAgents} agents`}` +
        `${view.parallel.sequentialEquivalent === null ? '' : `, sequential ${formatMinutes(view.parallel.sequentialEquivalent)}`}`,
    ]);
  }
  rows.push([
    'records',
    `${view.records.manual} manual, ${view.records.extras} extra${extras.length === 0 ? '' : ` (${extras.join(', ')})`}`,
  ]);
  const since = view.task.startedAt === undefined ? '' : ` since ${localTime(view.task.startedAt)}`;
  return [`${view.task.id} "${view.task.title}" ${view.task.status}${since}`, table(rows)].join('\n');
}

/** A moment in local time, in the same `YYYY-MM-DD HH:MM` form that `--at` accepts. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
