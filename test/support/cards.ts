import { noExtraTallies, type Card, type CardEstimate } from '../../src/domain/card/card.js';
import { EXTRA_CATEGORIES } from '../../src/domain/measurement/extra.js';

export interface CardSpec {
  readonly id: string;
  readonly author?: string;
  readonly type?: string;
  readonly stack?: readonly string[];
  /** Base of the first estimate in hours; null for a task without an estimate. */
  readonly base?: number | null;
  /** Fact in hours; by default `base × ratio`. */
  readonly ratio?: number;
  readonly factHours?: number;
  readonly outcome?: Card['outcome'];
  readonly closedAt?: string;
  readonly overrides?: Partial<Card>;
}

const estimate = (base: number, type: string): CardEstimate => ({
  optimisticHours: base,
  likelyHours: base,
  pessimisticHours: base,
  baseLikelyHours: base,
  calibrated: false,
  type,
});

/** A synthetic card v2 of a closed task: only what a test sets differs from a plain completed task. */
export function syntheticCard(spec: CardSpec): Card {
  const type = spec.type ?? 'feature';
  const base = spec.base === undefined ? 10 : spec.base;
  const factMinutes = Math.round((spec.factHours ?? (base ?? 10) * (spec.ratio ?? 1)) * 60);
  const fact = {
    totalMinutes: factMinutes,
    agentMinutes: factMinutes,
    userMinutes: 0,
    manualMinutes: 0,
    uncertaintyMinutes: 0,
    uncertaintyShare: 0,
    lowMinutes: factMinutes,
    highMinutes: factMinutes,
    agentWorkMinutes: factMinutes,
  };
  const first = base === null ? null : estimate(base, type);
  const empty = () => ({ count: 0, timed: 0, minutes: 0 });
  return {
    schemaVersion: 3,
    author: spec.author ?? 'dev@example.com',
    task: { id: spec.id, type, stack: [...(spec.stack ?? ['typescript'])] },
    outcome: spec.outcome ?? 'completed',
    startedAt: '2026-10-01T09:00:00.000Z',
    closedAt: spec.closedAt ?? '2026-10-02T18:00:00.000Z',
    calendarMinutes: factMinutes,
    closedMinutes: 0,
    estimate: first,
    currentEstimate: first,
    revisions: [],
    fact: { ...fact, counted: { ...fact, sequentialMinutes: null, minimal: false } },
    accuracy: 'partial',
    usage: null,
    backgroundAgents: false,
    parallel: { used: false, maxAgents: null, sequentialMinutes: null, budgetShare: null, planShare: null },
    parts: [],
    currentParts: [],
    partsFact: 'no-plan-snapshots',
    unattributedMinutes: factMinutes,
    beforeRevisionMinutes: 0,
    plan: { done: null, unfinishedGroups: 0 },
    extras: Object.fromEntries(EXTRA_CATEGORIES.map((category) => [category, { absorbed: empty(), renegotiated: empty() }])) as Card['extras'],
    coveredByRevision: noExtraTallies(),
    code: null,
    retro: 'pending',
    text: { title: `Task ${spec.id}`, projects: ['api'], parts: [], currentParts: [], revisions: [], unfinishedGroups: [], extras: [], manual: [] },
    ...spec.overrides,
  };
}
