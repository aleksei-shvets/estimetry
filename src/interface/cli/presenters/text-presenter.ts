import type { EstimateData } from '../../../domain/estimate/estimate.js';
import type { CalibrationView } from '../../../application/task/show-calibration.js';
import type { SimilarTasksView } from '../../../application/task/find-similar-tasks.js';
import type { RatioStats } from '../../../domain/calibration/calibration.js';
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
  similarTasks: similarText,
  calibration: calibrationText,
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
  const names = card.text.currentParts;
  const revised = card.revisions.length > 0;
  const counted = card.fact.counted;
  const of = (estimate: Card['estimate']) => (estimate === null ? '' : ` of ${formatMinutes(estimate.likelyHours * 60)}`);
  const rows: [string, string][] = [
    ['card', `${card.outcome}, ${card.accuracy} accuracy${card.backgroundAgents ? ', background agents' : ''}`],
  ];
  if (card.estimate === null) {
    rows.push(['fact', `${formatMinutes(card.fact.totalMinutes)} (no estimate)`]);
  } else if (!revised) {
    rows.push(['fact', `${formatMinutes(card.fact.totalMinutes)}${of(card.estimate)}`]);
  } else {
    // Two comparisons: the whole fact with the first estimate, the counted one with the estimate in force.
    rows.push(['fact', `${formatMinutes(card.fact.totalMinutes)}${of(card.estimate)} first estimate`]);
    rows.push(['counted', `${formatMinutes(counted.totalMinutes)}${of(card.currentEstimate)} current estimate`]);
    if (card.fact.totalMinutes > counted.totalMinutes) {
      rows.push(['lost', formatMinutes(card.fact.totalMinutes - counted.totalMinutes)]);
    }
    card.revisions.forEach((revision, i) => {
      const lost = revision.spent === 'exclude' ? `, lost ${formatMinutes(revision.lostMinutes)}` : '';
      rows.push([
        `revision ${i + 1}`,
        `${revision.category ?? '—'}, ${revision.spent ?? '—'}, at ${formatMinutes(revision.countedAtMinutes)}${lost}: ` +
          `${card.text.revisions[i]?.reason ?? ''}`,
      ]);
    });
  }
  card.currentParts.forEach((part, i) => {
    const name = names[i]?.name ?? `part ${i}`;
    const fact = part.factMinutes === null ? `— (${part.reason ?? card.partsFact})` : formatMinutes(part.factMinutes);
    rows.push([`  ${name}`, `${fact} of ${formatMinutes(part.likelyHours * 60)}${part.groupDone === false ? ', unfinished' : ''}`]);
  });
  if (card.currentParts.length > 0 && card.beforeRevisionMinutes > 0) {
    rows.push(['  before revision', formatMinutes(card.beforeRevisionMinutes)]);
  }
  if (card.currentParts.length > 0 && card.unattributedMinutes > 0) {
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
  const covered = Object.entries(card.coveredByRevision).flatMap(([category, tally]) => (tally.count === 0 ? [] : [`${category} ${tally.count}`]));
  if (covered.length > 0) {
    rows.push(['covered by revision', covered.join(', ')]);
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

function similarText(view: SimilarTasksView): string {
  const query = [
    view.query.type === null ? undefined : `type ${view.query.type}`,
    view.query.stack.length === 0 ? undefined : `stack ${view.query.stack.join(', ')}`,
    view.query.hours === null ? undefined : `about ${formatMinutes(view.query.hours * 60)}`,
  ].filter((part): part is string => part !== undefined);
  const lines: string[] = [];
  if (view.tasks.length === 0) {
    lines.push(`No similar closed tasks (${query.join(', ')}): the estimate rests on no past tasks.`);
  } else {
    lines.push(`Similar closed tasks (${query.join(', ')}):`);
    for (const task of view.tasks) {
      const matched = [
        task.matched.stack === undefined || task.matched.stack.common.length === 0 ? undefined : `stack ${task.matched.stack.common.join(', ')}`,
        task.matched.type === true ? 'type' : undefined,
        task.matched.size === undefined ? undefined : `size ×${task.matched.size.ratio}`,
      ].filter((part): part is string => part !== undefined);
      lines.push('', `${task.id} "${task.title}"  similarity ${task.score} (${matched.join(', ')})`);
      const estimate = task.firstEstimate === null ? 'no estimate' : `first estimate ${formatMinutes(task.firstEstimate.likelyHours * 60)}`;
      const ratio = task.ratio !== null ? ` → ×${task.ratio}` : task.excluded !== null ? ` (not calibrated: ${task.excluded})` : '';
      const type = task.currentType === task.type ? task.type : `${task.type} → ${task.currentType}`;
      lines.push(`  ${type}, ${task.outcome}${task.spawned === null ? '' : ` into ${task.spawned}`}; ${estimate}, fact ${formatMinutes(task.fact.totalMinutes)}${ratio}`);
      if (task.revisions.count > 0) {
        lines.push(`  revisions: ${task.revisions.count}${task.revisions.categories.length === 0 ? '' : ` (${task.revisions.categories.join(', ')})`}`);
      }
      const extras = Object.entries(task.extras).map(([category, tally]) => `${category} ${tally.count}${tally.minutes > 0 ? ` (${formatMinutes(tally.minutes)})` : ''}`);
      if (extras.length > 0) {
        lines.push(`  extra work: ${extras.join(', ')}`);
      }
      const parts = task.parts.flatMap((part) =>
        part.factMinutes === null ? [] : [`${part.name} ${formatMinutes(part.likelyHours * 60)} → ${formatMinutes(part.factMinutes)}${part.ratio === null ? '' : ` (×${part.ratio})`}`],
      );
      if (parts.length > 0) {
        lines.push(`  parts: ${parts.join(', ')}`);
      }
      if (task.unfinishedGroups > 0) {
        lines.push(`  unfinished groups: ${task.unfinishedGroups}`);
      }
      if (task.retro !== null) {
        lines.push(`  lesson: ${task.retro.lesson}`, ...task.retro.reasons.map((reason) => `  reason: ${reason}`));
      }
      const accuracy = [
        task.accuracy.manualOnly ? 'manual time only' : undefined,
        task.accuracy.uncertain ? 'uncertainty above 5%' : undefined,
        task.accuracy.backgroundAgents ? 'background agents' : undefined,
      ].filter((part): part is string => part !== undefined);
      if (accuracy.length > 0) {
        lines.push(`  accuracy: ${accuracy.join(', ')}`);
      }
    }
  }
  lines.push(...cardNotes(view));
  return lines.join('\n');
}

/** `type feature` and `stack go` rows of the slices of a query. */
function queried<T>(slices: { readonly byType: Readonly<Record<string, T>>; readonly byStack: Readonly<Record<string, T>> }): (readonly [string, T])[] {
  return [
    ...Object.entries(slices.byType).map(([key, stats]) => [`type ${key}`, stats] as const),
    ...Object.entries(slices.byStack).map(([key, stats]) => [`stack ${key}`, stats] as const),
  ];
}

function calibrationText(view: CalibrationView): string {
  const lines: string[] = [];
  const slices = queried(view.ratio);
  const coefficient = view.coefficient;
  const what = view.query.revise ? 'estimates made during work' : 'first estimates';
  if (coefficient !== null) {
    lines.push(
      `Coefficient ×${coefficient.value} (${coefficient.slice.kind} ${coefficient.slice.key}, ${coefficient.n} tasks, ${what}): ` +
        'multiply the optimistic, most likely and pessimistic hours of every part.',
    );
  } else if (view.skipped.length > 0) {
    // Not the sample: calibration without some cards could name a wrong coefficient.
    lines.push(`Without calibration: cards of a newer estimetry (${view.skipped.join(', ')}) cannot be read, so no coefficient is given — update estimetry.`);
  } else {
    const counts = (view.query.revise ? queried(view.revised) : slices).map(([name, stats]) => `${name} ${stats.n} of ${view.minTasks}`);
    const overall = view.query.revise ? view.revised.overall : view.ratio.overall;
    lines.push(
      (counts.length === 0
        ? 'Without calibration: give --type or --stack; only slices by type or technology are applied.'
        : `Without calibration: ${counts.join(', ')} tasks needed.`) +
        (overall.median === null ? '' : ` Overall ×${overall.median} (${overall.n} tasks) is for reference only.`),
    );
  }
  lines.push('', 'Fact over the first estimate:');
  const ratioRows: [string, string][] = [['overall', statsText(view.ratio.overall)], ...slices.map(([name, stats]): [string, string] => [name, statsText(stats)])];
  lines.push(table(ratioRows.map(([a, b]) => [`  ${a}`, b])));
  const revised = queried(view.revised).filter(([, stats]) => stats.n > 0);
  if (revised.length > 0) {
    lines.push('', 'Counted fact over estimates made during work:');
    lines.push(
      table(
        revised.map(([name, stats]) => [
          `  ${name}`,
          `${statsText(stats)}${stats.countedAtShare === null ? '' : `, revised at ${percent(stats.countedAtShare)} of the work`}`,
        ]),
      ),
    );
  }
  const revisions = Object.entries(view.revisions).flatMap(([category, bySpent]) =>
    Object.entries(bySpent).map(([spent, stats]) =>
      `  ${category} ${spent}: ${stats.n}, growth ${stats.growth === null ? '—' : `×${stats.growth}`}${stats.lostShare === null ? '' : `, lost ${percent(stats.lostShare)}`}`,
    ),
  );
  if (revisions.length > 0) {
    lines.push('', 'Revisions:', ...revisions);
  }
  const extras = Object.entries(view.extras).flatMap(([category, tally]) =>
    tally.absorbed.count + tally.renegotiated.count === 0
      ? []
      : [`  ${category}: ${percent(tally.absorbed.share)} absorbed, ${percent(tally.renegotiated.share)} renegotiated (${tally.absorbed.count + tally.renegotiated.count})`],
  );
  if (extras.length > 0) {
    lines.push('', 'Extra work, share of the base:', ...extras);
  }
  if (view.missedScope !== null && view.missedScope.median !== null) {
    lines.push('', `Missed scope: ×${view.missedScope.median} of the original estimate (${view.missedScope.n} tasks)`);
  }
  const speed = Object.entries(view.linesPerHour).flatMap(([label, stats]) => (stats.median === null ? [] : [`${label} ${Math.round(stats.median)} (${stats.n})`]));
  if (speed.length > 0) {
    lines.push('', `Lines per hour: ${speed.join(', ')}`);
  }
  const parts = Object.entries(view.parts).flatMap(([kind, stats]) => (stats.median === null ? [] : [`${kind} ×${stats.median} (${stats.n})`]));
  if (parts.length > 0) {
    lines.push('', `Parts, fact over estimate: ${parts.join(', ')}`);
  }
  // Skipped cards are named in the first line already.
  lines.push(...cardNotes({ skipped: [], otherAuthors: view.otherAuthors }));
  return lines.join('\n');
}

function statsText(stats: RatioStats): string {
  if (stats.n === 0) {
    return 'no tasks';
  }
  const excluded = Object.entries(stats.excluded).map(([reason, n]) => `${reason} ${n}`);
  return (
    `${stats.n} tasks, median ×${stats.median}, mean ×${stats.mean}${stats.applicable ? '' : ', too few to apply'}` +
    `${stats.revised > 0 ? `, ${stats.revised} revised` : ''}${stats.uncertain > 0 ? `, ${stats.uncertain} uncertain` : ''}` +
    `${excluded.length > 0 ? `; left out: ${excluded.join(', ')}` : ''}`
  );
}

function cardNotes(view: { readonly skipped: readonly string[]; readonly otherAuthors: number }): string[] {
  return [
    ...(view.skipped.length === 0 ? [] : ['', `Cards of a newer estimetry were left out (${view.skipped.join(', ')}): update estimetry.`]),
    ...(view.otherAuthors === 0
      ? []
      : ['', `${view.otherAuthors} card${view.otherAuthors === 1 ? ' is' : 's are'} of other authors; if they are yours under an earlier email, list it in author.aliases in config.yaml.`]),
  ];
}

/** The estimate in force, part by part: what a revision starts from. */
function estimateText(estimate: EstimateData): string {
  const sum = (point: 'optimistic' | 'likely' | 'pessimistic') => Math.round(estimate.parts.reduce((total, part) => total + part.hours[point], 0) * 100) / 100;
  const context = [
    estimate.type,
    estimate.stack === undefined ? undefined : estimate.stack.join(', '),
    estimate.calibrated ? `calibrated ×${estimate.calibration?.coefficient ?? '?'}` : 'without calibration',
    estimate.basedOn === undefined ? undefined : `based on ${estimate.basedOn.join(', ')}`,
  ].filter((part): part is string => part !== undefined);
  return table([
    ['estimate', `${sum('optimistic')} / ${sum('likely')} / ${sum('pessimistic')} h (${context.join('; ')})`],
    ...estimate.parts.map((part): [string, string] => [
      `  ${part.id}`,
      `${part.hours.optimistic} / ${part.hours.likely} / ${part.hours.pessimistic} h, ${part.kind}${part.who === undefined ? '' : `, ${part.who}`}${part.group === undefined ? '' : `, group ${part.group}`}`,
    ]),
  ]);
}

