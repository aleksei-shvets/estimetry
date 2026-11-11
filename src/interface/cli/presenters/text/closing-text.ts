import type { CloseSummary } from '../../../../application/task/show-close-summary.js';
import type { Card, CardUsage } from '../../../../domain/card/card.js';
import { factText, formatMinutes, table, tokenCount } from './format.js';

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

export function cardText(card: Card): string {
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
  if (card.fact.lowMinutes !== null && card.fact.highMinutes !== null) {
    rows.splice(2, 0, ['uncertainty', `${formatMinutes(card.fact.lowMinutes)} – ${formatMinutes(card.fact.highMinutes)}`]);
  }
  rows.push(...usageRows(card.usage));
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

/** The cost with how many of the task's sessions have a log, then tokens by model. */
export function usageRows(usage: CardUsage | null): [string, string][] {
  if (usage === null) {
    return [];
  }
  const cost =
    usage.costUSD === null
      ? 'unknown'
      : `$${usage.costUSD.toFixed(2)}${usage.approximate ? ' (approximate: split by tokens)' : ''}`;
  const models = Object.entries(usage.tokens).map(
    ([model, t]): [string, string] => [
      `  ${model}`,
      `in ${tokenCount(t.input)}, out ${tokenCount(t.output)}, cache read ${tokenCount(t.cacheRead)}, cache write ${tokenCount(t.cacheWrite5m + t.cacheWrite1h)}`,
    ],
  );
  return [['cost', `${cost}, from the logs of ${usage.withLogs} of ${usage.sessions} sessions`], ...(models.length === 0 ? [] : [['tokens', ''] as [string, string], ...models])];
}
