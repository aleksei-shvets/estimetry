import type { EstimateData } from '../../../../domain/estimate/estimate.js';
import type { CalibrationView } from '../../../../application/task/show-calibration.js';
import type { SimilarTasksView } from '../../../../application/task/find-similar-tasks.js';
import type { RatioStats } from '../../../../domain/calibration/calibration.js';
import { CalibrationPolicy } from '../../../../domain/calibration/calibration-policy.js';
import { formatMinutes, percent, table } from './format.js';

export function similarText(view: SimilarTasksView): string {
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
        task.matched.stack === undefined || task.matched.stack.common.length === 0
          ? undefined
          : `stack ${task.matched.stack.common.join(', ')}`,
        task.matched.type === true ? 'type' : undefined,
        task.matched.size === undefined ? undefined : `size ×${task.matched.size.ratio}`,
      ].filter((part): part is string => part !== undefined);
      lines.push('', `${task.id} "${task.title}"  similarity ${task.score} (${matched.join(', ')})`);
      const estimate = task.firstEstimate === null ? 'no estimate' : `first estimate ${formatMinutes(task.firstEstimate.likelyHours * 60)}`;
      const ratio = task.ratio !== null ? ` → ×${task.ratio}` : task.excluded !== null ? ` (not calibrated: ${task.excluded})` : '';
      const type = task.currentType === task.type ? task.type : `${task.type} → ${task.currentType}`;
      const spawned = task.spawned === null ? '' : ` into ${task.spawned}`;
      lines.push(`  ${type}, ${task.outcome}${spawned}; ${estimate}, fact ${formatMinutes(task.fact.totalMinutes)}${ratio}`);
      if (task.revisions.count > 0) {
        const categories = task.revisions.categories.length === 0 ? '' : ` (${task.revisions.categories.join(', ')})`;
        lines.push(`  revisions: ${task.revisions.count}${categories}`);
      }
      const extras = Object.entries(task.extras).map(
        ([category, tally]) => `${category} ${tally.count}${tally.minutes > 0 ? ` (${formatMinutes(tally.minutes)})` : ''}`,
      );
      if (extras.length > 0) {
        lines.push(`  extra work: ${extras.join(', ')}`);
      }
      const parts = task.parts.flatMap((part) => {
        const ratio = part.ratio === null ? '' : ` (×${part.ratio})`;
        if (part.factMinutes === null) {
          return [];
        }
        return [`${part.name} ${formatMinutes(part.likelyHours * 60)} → ${formatMinutes(part.factMinutes)}${ratio}`];
      });
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
function queried<T>(slices: {
  readonly byType: Readonly<Record<string, T>>;
  readonly byStack: Readonly<Record<string, T>>;
}): (readonly [string, T])[] {
  return [
    ...Object.entries(slices.byType).map(([key, stats]) => [`type ${key}`, stats] as const),
    ...Object.entries(slices.byStack).map(([key, stats]) => [`stack ${key}`, stats] as const),
  ];
}

export function calibrationText(view: CalibrationView): string {
  const slices = queried(view.ratio);
  const lines: string[] = [coefficientLine(view), settingsLine(view)];
  lines.push('', 'Fact over the first estimate:');
  const ratioRows: [string, string][] = [
    ['overall', statsText(view.ratio.overall)],
    ...slices.map(([name, stats]): [string, string] => [name, statsText(stats)]),
  ];
  lines.push(table(ratioRows.map(([a, b]) => [`  ${a}`, b])));
  const revised = queried(view.revised).filter(([, stats]) => stats.n > 0);
  if (revised.length > 0) {
    lines.push('', 'Counted fact over estimates made during work:');
    lines.push(
      table(
        revised.map(([name, stats]) => {
          const at = stats.countedAtShare === null ? '' : `, revised at ${percent(stats.countedAtShare)} of the work`;
          return [`  ${name}`, `${statsText(stats)}${at}`];
        }),
      ),
    );
  }
  lines.push(...revisionAndExtraLines(view));
  if (view.missedScope !== null && view.missedScope.median !== null) {
    lines.push('', `Missed scope: ×${view.missedScope.median} of the original estimate (${view.missedScope.n} tasks)`);
  }
  const speed = Object.entries(view.linesPerHour).flatMap(([label, stats]) =>
    stats.median === null ? [] : [`${label} ${Math.round(stats.median)} (${stats.n})`],
  );
  if (speed.length > 0) {
    lines.push('', `Lines per hour: ${speed.join(', ')}`);
  }
  const parts = Object.entries(view.parts).flatMap(([kind, stats]) =>
    stats.median === null ? [] : [`${kind} ×${stats.median} (${stats.n})`],
  );
  if (parts.length > 0) {
    lines.push('', `Parts, fact over estimate: ${parts.join(', ')}`);
  }
  // Skipped cards are named in the first line already.
  lines.push(...cardNotes({ skipped: [], otherAuthors: view.otherAuthors }));
  return lines.join('\n');
}

/** The coefficient to apply with what it rests on, or why there is none. */
function coefficientLine(view: CalibrationView): string {
  const coefficient = view.coefficient;
  if (coefficient !== null) {
    const what = view.query.revise ? 'estimates made during work' : 'first estimates';
    const slice = coefficient.slice.kind === 'overall' ? 'overall' : `${coefficient.slice.kind} ${coefficient.slice.key}`;
    const value = times(coefficient.value);
    const pessimistic = times(coefficient.pessimistic);
    return (
      `Coefficient ${value} from ${coefficient.n} ${coefficient.n === 1 ? 'task' : 'tasks'} (weight ${percent(coefficient.weight)}), ` +
      `slice ${slice}; pessimistic ${pessimistic} (${what}): ` +
      `multiply the optimistic and most likely hours of every part by ${value}, the pessimistic hours by ${pessimistic}.`
    );
  }
  if (view.skipped.length > 0) {
    // Not the sample: calibration without some cards could name a wrong coefficient.
    return (
      `Without calibration: cards of a newer estimetry (${view.skipped.join(', ')}) cannot be read, ` +
      'so no coefficient is given — update estimetry.'
    );
  }
  const overall = view.query.revise ? view.revised.overall : view.ratio.overall;
  if (view.tasks === 0) {
    return 'Without calibration: no closed task yet.';
  }
  if (overall.n === 0) {
    if (view.query.revise) {
      return 'Without calibration: no revised task counts yet.';
    }
    // A card without an estimate is neither a sample nor left out: there is nothing below to point to.
    return Object.keys(overall.excluded).length === 0
      ? 'Without calibration: none of the closed tasks has an estimate.'
      : 'Without calibration: none of the closed tasks counts (see what is left out below).';
  }
  return `Without calibration: ${overall.n} of ${view.minTasks} tasks needed (calibration.minTasks).`;
}

/** The calibration settings in force, with or without a coefficient; `emt help calibrate` describes them. */
function settingsLine(view: CalibrationView): string {
  const defaults = view.minTasks === CalibrationPolicy.DEFAULT.minTasks && view.shrink === CalibrationPolicy.DEFAULT.shrink;
  const mark = defaults ? ' (the defaults)' : '';
  return `Settings: calibration.minTasks ${view.minTasks}, calibration.shrink ${view.shrink}${mark}; see emt help calibrate.`;
}

/** A coefficient in text: two decimals are enough to read; `--json` keeps three. */
function times(value: number): string {
  return `×${Math.round(value * 100) / 100}`;
}

/** Revisions by category and `spent`, and extra work by category: shares of the base. */
function revisionAndExtraLines(view: CalibrationView): string[] {
  const lines: string[] = [];
  const revisions = Object.entries(view.revisions).flatMap(([category, bySpent]) =>
    Object.entries(bySpent).map(([spent, stats]) => {
      const growth = stats.growth === null ? '—' : `×${stats.growth}`;
      const lost = stats.lostShare === null ? '' : `, lost ${percent(stats.lostShare)}`;
      return `  ${category} ${spent}: ${stats.n}, growth ${growth}${lost}`;
    }),
  );
  if (revisions.length > 0) {
    lines.push('', 'Revisions:', ...revisions);
  }
  const extras = Object.entries(view.extras).flatMap(([category, tally]) => {
    const count = tally.absorbed.count + tally.renegotiated.count;
    const shares = `${percent(tally.absorbed.share)} absorbed, ${percent(tally.renegotiated.share)} renegotiated`;
    return count === 0 ? [] : [`  ${category}: ${shares} (${count})`];
  });
  if (extras.length > 0) {
    lines.push('', 'Extra work, share of the base:', ...extras);
  }
  return lines;
}

function statsText(stats: RatioStats): string {
  if (stats.n === 0) {
    return 'no tasks';
  }
  const excluded = Object.entries(stats.excluded).map(([reason, n]) => `${reason} ${n}`);
  // The weight of a whole slice is not what its level weighs in the coefficient: only the coefficient line names one.
  const tooFew = stats.weight > 0 ? '' : ', too few to apply';
  return (
    `${stats.n} tasks, median ×${stats.median}, mean ×${stats.mean}${tooFew}` +
    `${stats.revised > 0 ? `, ${stats.revised} revised` : ''}${stats.uncertain > 0 ? `, ${stats.uncertain} uncertain` : ''}` +
    `${excluded.length > 0 ? `; left out: ${excluded.join(', ')}` : ''}`
  );
}

function cardNotes(view: { readonly skipped: readonly string[]; readonly otherAuthors: number }): string[] {
  return [
    ...(view.skipped.length === 0 ? [] : ['', `Cards of a newer estimetry were left out (${view.skipped.join(', ')}): update estimetry.`]),
    ...(view.otherAuthors === 0
      ? []
      : [
          '',
          `${view.otherAuthors} ${view.otherAuthors === 1 ? 'card is' : 'cards are'} of other authors; ` +
            'if they are yours under an earlier email, list it in author.aliases in config.yaml.',
        ]),
  ];
}

/** The estimate in force, part by part: what a revision starts from. */
export function estimateText(estimate: EstimateData): string {
  const sum = (point: 'optimistic' | 'likely' | 'pessimistic') =>
    Math.round(estimate.parts.reduce((total, part) => total + part.hours[point], 0) * 100) / 100;
  const context = [
    estimate.type,
    estimate.stack === undefined ? undefined : estimate.stack.join(', '),
    estimate.calibrated ? calibratedText(estimate.calibration) : 'without calibration',
    estimate.basedOn === undefined ? undefined : `based on ${estimate.basedOn.join(', ')}`,
  ].filter((part): part is string => part !== undefined);
  return table([
    ['estimate', `${sum('optimistic')} / ${sum('likely')} / ${sum('pessimistic')} h (${context.join('; ')})`],
    ...estimate.parts.map((part): [string, string] => {
      const who = part.who === undefined ? '' : `, ${part.who}`;
      const group = part.group === undefined ? '' : `, group ${part.group}`;
      return [`  ${part.id}`, `${part.hours.optimistic} / ${part.hours.likely} / ${part.hours.pessimistic} h, ${part.kind}${who}${group}`];
    }),
  ]);
}

function calibratedText(calibration: EstimateData['calibration']): string {
  const pessimistic = calibration?.pessimistic === undefined ? '' : `, pessimistic ×${calibration.pessimistic}`;
  return `calibrated ×${calibration?.coefficient ?? '?'}${pessimistic}`;
}
