import type { InitReport } from '../../../application/project/init-project.js';
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

  parallelModeChanged: ({ task, enabled, budgetShare, planShare }) => {
    if (!enabled) {
      return `Parallel mode off for ${task.id}`;
    }
    const shares = [
      ...(budgetShare === undefined ? [] : [`${percent(budgetShare)} of the budget spent`]),
      ...(planShare === undefined ? [] : [`plan ${percent(planShare)} done`]),
    ];
    return `Parallel mode on for ${task.id}${shares.length === 0 ? '' : ` (${shares.join(', ')})`}`;
  },

  status: (view) => statusText(view),

  initReport: (report) => initText(report),
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
  rows.push(...planRows(view));
  const since = view.task.startedAt === undefined ? '' : ` since ${localTime(view.task.startedAt)}`;
  return [`${view.task.id} "${view.task.title}" ${view.task.status}${since}`, table(rows)].join('\n');
}

function untrackedText(project: StatusView['untrackedProjects'][number]): string {
  switch (project.reason) {
    case 'flow-none':
      return "the project's flow has no plan";
    case 'unknown-flow':
      return `unknown flow "${project.flow ?? ''}" in .estimetry/config.yaml`;
    case 'no-config':
      return 'the project has no .estimetry/config.yaml';
    case 'not-on-this-machine':
      return 'the project is not on this machine';
  }
}

function planRows(view: StatusView): [string, string][] {
  const plan = view.plan;
  if (plan === null) {
    const first = view.untrackedProjects[0];
    return view.planUnavailable === null || first === undefined ? [] : [['plan', `not tracked: ${untrackedText(first)}`]];
  }
  const rows: [string, string][] = [
    [
      'plan',
      plan.mode === 'changes'
        ? `${plan.done}% done by changes (${formatMinutes((plan.groupedHours ?? 0) * 60)} of ${formatMinutes((plan.estimateHours ?? 0) * 60)} in groups)`
        : `${plan.done}% done by checkboxes (not linked to the estimate)`,
    ],
  ];
  if (plan.notStarted.length > 0) {
    rows.push(['  not started', plan.notStarted.join(', ')]);
  }
  if (plan.possibleTypos.length > 0) {
    rows.push(['  possible typo', plan.possibleTypos.map(({ group, similar }) => `${group} (${similar}?)`).join(', ')]);
  }
  if (plan.archivedBeforeStart.length > 0) {
    rows.push(['  archived before start', plan.archivedBeforeStart.join(', ')]);
  }
  if (view.untrackedProjects.length > 0) {
    rows.push(['  not tracked', view.untrackedProjects.map((project) => `${project.project} (${untrackedText(project)})`).join(', ')]);
  }
  const last = view.completedChanges.at(-1);
  if (last !== undefined) {
    const moment = last.approximate ? `${last.completedAt.slice(0, 10)} (approx.)` : localTime(last.completedAt);
    rows.push(['changes', `${view.completedChanges.length} done, last ${last.change} ${moment}`]);
  }
  return rows;
}

/** A moment in local time, in the same `YYYY-MM-DD HH:MM` form that `--at` accepts. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initText(report: InitReport): string {
  const lines = [
    `Initialized estimetry in project ${report.project} (flow ${report.flow}, tools ${report.tools.join(', ')})`,
    `stack: ${report.stack.length === 0 ? '(nothing detected)' : report.stack.join(', ')}`,
    table(report.files.map((file) => [`  ${file.status}`, file.reason === undefined ? file.path : `${file.path}: ${file.reason}`])),
    ...report.warnings.map((warning) => `warning: ${warning}`),
    'Next: ask the agent for an estimate (/emt-estimate) or create a task with `emt task new "<title>"`.',
  ];
  return lines.filter((line) => line !== '').join('\n');
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
