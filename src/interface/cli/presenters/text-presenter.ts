import type { Presenter } from './presenter.js';
import { cardText, closeSummaryText } from './text/closing-text.js';
import { calibrationText, estimateText, similarText } from './text/estimate-text.js';
import { factText, formatMinutes, localTime, percent, table } from './text/format.js';
import { textNotices } from './text/notices-text.js';
import { initText, statusText } from './text/task-text.js';

export const textPresenter: Presenter = {
  notices: textNotices,

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

  taskDetails: (task) => {
    const details = table(
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
        ['closed', task.closedAt === undefined ? undefined : `${localTime(task.closedAt)} (${task.outcome ?? 'completed'})`],
        ['spawned from', task.spawnedFrom],
        ['spawned', task.spawned],
      ].filter((row): row is [string, string] => row[1] !== undefined),
    );
    if (task.card !== undefined) {
      return `${details}\n\n${cardText(task.card)}`;
    }
    return task.estimate === undefined ? details : `${details}\n\n${estimateText(task.estimate)}`;
  },

  taskStarted: (task) => `Started ${task.id} "${task.title}"`,

  taskAttached: ({ task, project, attached }) =>
    attached ? `Attached ${task.id} to project ${project}` : `${task.id} is already attached to project ${project}`,

  estimateSaved: ({ task, total, parts }) =>
    `Estimate saved for ${task.id}: ${total.optimistic} / ${total.likely} / ${total.pessimistic} h, ${parts} part${parts === 1 ? '' : 's'}` +
    (task.status === 'in-progress'
      ? ''
      : `\nTime is not measured yet: start the task when work begins with \`emt start ${task.id}\` (or /emt-start); add --at "YYYY-MM-DD HH:MM" if it already began.`),

  revisionRepaired: (r) => `Wrote the plan snapshot of revision ${r.revision} of ${r.task.id}.`,

  estimateRevised: (r) =>
    r.firstEstimate
      ? `Estimate saved for ${r.task.id} after its start: ${r.total.optimistic} / ${r.total.likely} / ${r.total.pessimistic} h. It is not used for calibration.`
      : `Revised the estimate of ${r.task.id} from ${localTime(r.at)}: ${r.total.optimistic} / ${r.total.likely} / ${r.total.pessimistic} h, ` +
        (r.spent === 'exclude' && r.lostFrom !== null
          ? `work from ${localTime(r.lostFrom)} is lost and not counted` +
            (r.excluded.some((project) => project.archives.length > 0) ? '; archived changes of that time leave the plan' : '')
          : 'the work so far counts') +
        '.',

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

  closeSummary: closeSummaryText,

  initReport: (report) => initText(report),

  taskClosed: (result) =>
    `Closed ${result.task.id} "${result.task.title}"${result.outcome === 'completed' ? '' : ` (${result.outcome})`}: ` +
    `${factText(result.fact, result.estimateHours, result.estimateShare)}.\n` +
    `Now record the retro with the user: emt retro --reason "<why>" --lesson "<one lesson>" (or /emt-retro).`,

  taskReopened: ({ task }) => `Reopened ${task.id} "${task.title}"; it is in progress again.`,

  retroRecorded: ({ task, reasons, lesson }) =>
    [`Retro recorded for ${task.id}:`, ...reasons.map((r) => `  - ${r.part === undefined ? '' : `[${r.part}] `}${r.text}`), `  lesson: ${lesson}`].join('\n'),

  renegotiated: ({ closed, spawned }) =>
    `Closed ${closed.task.id} as renegotiated: ${factText(closed.fact, closed.estimateHours, closed.estimateShare)}.\n` +
    `Created ${spawned.id} "${spawned.title}" for the rest. Next: estimate it (/emt-estimate), start it, and attach sessions with \`emt attach ${spawned.id} --session <id>\`.`,

  rebuildReport: (report) =>
    [
      `Rebuilt ${report.tasks} task${report.tasks === 1 ? '' : 's'}, ${report.cards} card${report.cards === 1 ? '' : 's'}.`,
      ...report.failed.map((f) => `failed: ${f.task}: ${f.error}`),
      ...(report.calibrationError === undefined ? [] : [`calibration.json not written: ${report.calibrationError}`]),
    ].join('\n'),
  similarTasks: similarText,
  calibration: calibrationText,
};
