import type { InitReport } from '../../../application/project/init-project.js';
import type { CloseSummary } from '../../../application/task/close-task.js';
import type { Card } from '../../../domain/card/card.js';
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
    return task.card === undefined ? details : `${details}\n\n${cardText(task.card)}`;
  },

  taskStarted: (task) => `Started ${task.id} "${task.title}"`,

  taskAttached: ({ task, project, attached }) =>
    attached ? `Attached ${task.id} to project ${project}` : `${task.id} is already attached to project ${project}`,

  estimateSaved: ({ task, total, parts }) =>
    `Estimate saved for ${task.id}: ${total.optimistic} / ${total.likely} / ${total.pessimistic} h, ${parts} part${parts === 1 ? '' : 's'}` +
    (task.status === 'in-progress'
      ? ''
      : `\nTime is not measured yet: start the task when work begins with \`emt start ${task.id}\` (or /emt-start); add --at "YYYY-MM-DD HH:MM" if it already began.`),

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
};

function factText(fact: number, likely: number | null, share: number | null): string {
  return likely === null
    ? `${formatMinutes(fact)} (no estimate)`
    : `${formatMinutes(fact)} of ${formatMinutes(likely * 60)}${share === null ? '' : ` (${percent(share)})`}`;
}

/** What the user sees before agreeing to close. */
export function closeSummaryText(summary: CloseSummary): string {
  return table(
    [
      ['task', `${summary.task.id} "${summary.task.title}"`],
      ['fact', factText(summary.fact, summary.estimateHours, summary.estimateShare)],
      ['plan', summary.planDone === null ? undefined : `${summary.planDone}% done`],
      ['unfinished', summary.unfinishedGroups.length === 0 ? undefined : summary.unfinishedGroups.join(', ')],
    ].filter((row): row is [string, string] => row[1] !== undefined),
  );
}

function cardText(card: Card): string {
  const names = card.text.parts;
  const rows: [string, string][] = [
    ['card', `${card.outcome}, ${card.accuracy} accuracy${card.backgroundAgents ? ', background agents' : ''}`],
    [
      'fact',
      card.estimate === null
        ? `${formatMinutes(card.fact.totalMinutes)} (no estimate)`
        : `${formatMinutes(card.fact.totalMinutes)} of ${formatMinutes(card.estimate.likelyHours * 60)}`,
    ],
  ];
  card.parts.forEach((part, i) => {
    const name = names[i]?.name ?? `part ${i}`;
    const fact = part.factMinutes === null ? `— (${part.reason ?? card.partsFact})` : formatMinutes(part.factMinutes);
    rows.push([`  ${name}`, `${fact} of ${formatMinutes(part.likelyHours * 60)}${part.groupDone === false ? ', unfinished' : ''}`]);
  });
  if (card.parts.length > 0 && card.unattributedMinutes > 0) {
    rows.push(['  unattributed', formatMinutes(card.unattributedMinutes)]);
  }
  const extras = Object.entries(card.extras).flatMap(([category, tally]) =>
    tally.absorbed.count + tally.renegotiated.count === 0
      ? []
      : [`${category} ${tally.absorbed.count + tally.renegotiated.count}${tally.renegotiated.count > 0 ? ` (${tally.renegotiated.count} renegotiated)` : ''}`],
  );
  if (extras.length > 0) {
    rows.push(['extras', extras.join(', ')]);
  }
  if (card.code !== null) {
    const l = card.code.lines;
    rows.push([
      'code',
      `production +${l.production.added} −${l.production.deleted}, tests +${l.tests.added} −${l.tests.deleted}, ` +
        `config +${l.config.added}, docs +${l.docs.added}` +
        `${l.generatedFiles > 0 ? `, ${l.generatedFiles} generated files left out` : ''}` +
        `${card.code.projects.some((p) => p.source === 'unknown') ? ' (some projects unknown)' : ''}`,
    ]);
  }
  if (card.retro === 'pending') {
    rows.push(['retro', 'pending: run `emt retro`']);
  } else {
    const retro = card.text.retro;
    rows.push(['retro', `${card.retro.status === 'stale' ? '(before reopening) ' : ''}${retro?.lesson ?? ''}`]);
    for (const reason of retro?.reasons ?? []) {
      rows.push(['  reason', `${reason.part === undefined ? '' : `[${reason.part}] `}${reason.text}`]);
    }
  }
  return table(rows);
}

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
  // With revisions every line about the fact is about the counted fact; the whole one is shown apart.
  const revised = view.revisions.length > 0;
  const shown = revised ? view.counted : view;
  const uncertainty =
    `± ${formatMinutes(shown.uncertainty)}` +
    (shown.uncertaintyShare === null ? '' : ` (${percent(shown.uncertaintyShare)})`) +
    (shown.uncertaintyExceedsTarget ? ', above the 5% target' : '');
  const extras = Object.entries(view.records.extraMinutesByCategory).map(
    ([category, minutes]) => `${category} ${formatMinutes(minutes)}`,
  );
  const last = view.revisions.at(-1);
  // Against the estimate goes the counted fact: without work thrown away by revisions.
  const counted = view.revisions.length === 0 ? view.fact : view.counted.fact;
  const estimateText =
    view.estimate === null
      ? ' (no estimate)'
      : ` of ${formatMinutes(view.estimate.likely * 60)}${view.estimateShare === null ? '' : ` (${percent(view.estimateShare)})`}`;
  const rows: [string, string][] = [
    ['fact', `${formatMinutes(counted)}${estimateText}${last === undefined ? '' : `   revised ${localTime(last.at)}`}`],
    ['  agents', formatMinutes(shown.agentTime)],
    ['  user', formatMinutes(shown.userTime)],
    ...lostRows(view),
    ['uncertainty', uncertainty],
    ['manual', `${formatMinutes(shown.manualTime)}${shown.manualShare === null ? '' : ` (${percent(shown.manualShare)} of fact)`}`],
    ['agent work', formatMinutes(shown.agentWork)],
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
  const since =
    (view.task.startedAt === undefined ? '' : ` since ${localTime(view.task.startedAt)}`) +
    (view.task.closedAt === undefined ? '' : `, closed ${localTime(view.task.closedAt)}`);
  const notStarted =
    view.task.status === 'new' || view.task.status === 'estimated'
      ? [`not started: the time of sessions is not counted until \`emt start ${view.task.id}\` (add --at "YYYY-MM-DD HH:MM" if work already began)`]
      : [];
  return [`${view.task.id} "${view.task.title}" ${view.task.status}${since}`, ...notStarted, table(rows)].join('\n');
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

function lostRows(view: StatusView): [string, string][] {
  const rows: [string, string][] = [];
  if (view.lost > 0) {
    const windows = view.revisions
      .filter((revision) => revision.spent === 'exclude' && revision.lostFrom !== null)
      .map((revision) => {
        const from = localTime(revision.lostFrom as string);
        const to = localTime(revision.at);
        // The end keeps its date when the window crosses midnight.
        const window = `${from}–${to.slice(0, 10) === from.slice(0, 10) ? to.slice(11) : to}`;
        return revision.category === null ? window : `${revision.category}, ${window}`;
      });
    rows.push(['  lost', `${formatMinutes(view.lost)} (${windows.join('; ')})`]);
  }
  if (view.revisions.length > 0) {
    rows.push(['  all', `${formatMinutes(view.fact)} with the lost work`]);
  }
  if (view.revisions.some((revision) => revision.missingSnapshot)) {
    rows.push(['  warning', 'a revision has no plan snapshot; run `emt estimate revise --repair`']);
  }
  return rows;
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
  if (plan.archivedBeforeRevision.length > 0) {
    rows.push(['  archived before revision', plan.archivedBeforeRevision.join(', ')]);
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
