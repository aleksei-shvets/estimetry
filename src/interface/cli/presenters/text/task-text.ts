import type { InitReport } from '../../../../application/project/init-project.js';
import type { StatusView } from '../../../../application/task/show-status.js';
import { usageRows } from './closing-text.js';
import { formatMinutes, localTime, percent, table } from './format.js';

export function statusText(view: StatusView): string {
  // With revisions every line about the fact is about the counted fact; the whole one is shown apart.
  const revised = view.revisions.length > 0;
  const shown = revised ? view.counted : view;
  const notes = [
    shown.uncertaintyShare === null ? undefined : `${percent(shown.uncertaintyShare)} of the fact`,
    shown.uncertaintyExceedsTarget ? 'above the 5% target' : undefined,
  ].filter((note) => note !== undefined);
  // The fact lies in this range: the heuristics may have counted too much or left out work.
  const uncertainty = `${formatMinutes(shown.factLow)} – ${formatMinutes(shown.factHigh)}${notes.length === 0 ? '' : ` (${notes.join(', ')})`}`;
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
  rows.push(...usageRows(view.usage));
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

export function initText(report: InitReport): string {
  const lines = [
    `Initialized estimetry in project ${report.project} (flow ${report.flow}, tools ${report.tools.join(', ')})`,
    `stack: ${report.stack.length === 0 ? '(nothing detected)' : report.stack.join(', ')}`,
    table(report.files.map((file) => [`  ${file.status}`, file.reason === undefined ? file.path : `${file.path}: ${file.reason}`])),
    ...report.warnings.map((warning) => `warning: ${warning}`),
    'Next: ask the agent for an estimate (/emt-estimate) or create a task with `emt task new "<title>"`.',
  ];
  return lines.filter((line) => line !== '').join('\n');
}
