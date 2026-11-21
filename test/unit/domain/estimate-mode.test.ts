import { StackLabels } from '../../../src/domain/estimate/stack-labels.js';
import { describe, expect, it } from 'vitest';
import { applicableCoefficient } from '../../../src/domain/calibration/applicable-coefficient.js';
import { calibrate, normalized, type AuthorCalibration } from '../../../src/domain/calibration/calibration.js';
import { CalibrationPolicy } from '../../../src/domain/calibration/calibration-policy.js';
import type { Card } from '../../../src/domain/card/card.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { similarTasks } from '../../../src/domain/similarity/similarity.js';
import { syntheticCard } from '../../support/cards.js';

const ME = 'dev@example.com';
const ids = (list: { card: { task: { id: string } } }[]) => list.map((item) => item.card.task.id);

describe('similar tasks', () => {
  it('a shared stack ranks first; the type alone gives 0.375', () => {
    const cards = [syntheticCard({ id: 'T-2', stack: ['go'] }), syntheticCard({ id: 'T-1', stack: ['flutter', 'bloc'] })];
    const result = similarTasks(cards, { author: ME, type: 'feature', stack: StackLabels.of(['flutter', 'bloc']) });
    expect(result.map((r) => [r.card.task.id, r.score])).toEqual([['T-1', 1], ['T-2', 0.375]]);
    expect(result[0]?.matched).toEqual({ stack: { common: ['flutter', 'bloc'], share: 1 }, type: true });
  });

  it('size counts with --hours and only for a card with an estimate', () => {
    const sized = similarTasks([syntheticCard({ id: 'T-1', base: 20 })], { author: ME, type: 'feature', stack: StackLabels.of([]), hours: 10 });
    expect(sized[0]).toMatchObject({ score: 0.8, matched: { size: { ratio: 2, share: 0.5 } } });
    const unestimated = similarTasks([syntheticCard({ id: 'T-1', base: null, factHours: 40 })], { author: ME, type: 'feature', stack: StackLabels.of([]), hours: 10 });
    expect(unestimated[0]).toMatchObject({ score: 1, matched: { type: true } });
    expect(unestimated[0]?.matched.size).toBeUndefined();
  });

  it('compares labels in lower case and leaves out a card without labels from the stack component', () => {
    const result = similarTasks([syntheticCard({ id: 'T-1', stack: ['flutter'] }), syntheticCard({ id: 'T-2', stack: [] })], {
      author: ME,
      type: 'feature',
      stack: StackLabels.of(['Flutter']),
    });
    expect(result.map((r) => [r.card.task.id, r.score])).toEqual([['T-1', 1], ['T-2', 1]]);
    expect(result[1]?.matched.stack).toBeUndefined();
  });

  it('takes the type of the first estimate', () => {
    const revised = syntheticCard({ id: 'T-1', overrides: { currentEstimate: { ...syntheticCard({ id: 'x' }).estimate!, type: 'research' } } });
    expect(similarTasks([revised], { author: ME, type: 'feature', stack: StackLabels.of(['go']) })[0]?.matched.type).toBe(true);
  });

  it('leaves out tasks sharing nothing, abandoned ones and those of other authors; aliases count', () => {
    const cards = [
      syntheticCard({ id: 'T-1', type: 'feature', stack: ['flutter'] }),
      syntheticCard({ id: 'T-2', type: 'research', stack: ['go'], outcome: 'abandoned' }),
      syntheticCard({ id: 'T-3', type: 'research', author: 'other@example.com' }),
      syntheticCard({ id: 'T-4', type: 'research', author: 'old@example.com' }),
    ];
    const result = similarTasks(cards, { author: ME, aliases: new Map([['old@example.com', ME]]), type: 'research', stack: StackLabels.of(['go']) });
    expect(ids(result)).toEqual(['T-4']);
  });

  it('orders equal scores by the later closing and keeps the limit', () => {
    const cards = [1, 5, 3].map((day) => syntheticCard({ id: `T-${day}`, closedAt: `2026-11-0${day}T10:00:00.000Z` }));
    expect(ids(similarTasks(cards, { author: ME, type: 'feature', stack: StackLabels.of([]), limit: 2 }))).toEqual(['T-5', 'T-3']);
  });

  it('shows the ratio as calibration counts it, or why the task is left out', () => {
    const renegotiated = syntheticCard({
      id: 'T-1',
      factHours: 5,
      outcome: 'renegotiated',
      overrides: {
        parts: [
          { kind: 'implementation', likelyHours: 4, factMinutes: null, groupDone: true, soleInGroup: true },
          { kind: 'implementation', likelyHours: 6, factMinutes: null, groupDone: false, soleInGroup: true },
        ],
      },
    });
    const late = syntheticCard({ id: 'T-2', overrides: { estimatedAfterStart: true } });
    const result = similarTasks([renegotiated, late], { author: ME, type: 'feature', stack: StackLabels.of([]) });
    expect(result.find((r) => r.card.task.id === 'T-1')?.ratio).toEqual({ ratio: 1.25 });
    expect(result.find((r) => r.card.task.id === 'T-2')?.ratio).toEqual({ excluded: 'estimated-after-start' });
  });
});

describe('applicable coefficient', () => {
  const STRICT = CalibrationPolicy.fromConfig({ minTasks: 5 });
  const sample = (n: number, spec: { type?: string; stack: string[]; ratio: number }) =>
    Array.from({ length: n }, (_, i) => syntheticCard({ id: `T-${spec.type ?? 'f'}-${spec.stack.join('')}-${i}`, type: spec.type ?? 'feature', stack: spec.stack, ratio: spec.ratio }));
  const ratios = (...values: number[]) => values.map((ratio, i) => syntheticCard({ id: `T-${i}`, ratio }));
  const coefficient = (
    cards: readonly Card[],
    query: { type?: string; stack?: string[]; revise?: boolean } = {},
    policy: CalibrationPolicy = CalibrationPolicy.DEFAULT,
  ) =>
    applicableCoefficient(
      normalized(cards).filter((card) => card.author === ME),
      { ...(query.type === undefined ? {} : { type: query.type }), stack: StackLabels.of(query.stack ?? []), ...(query.revise ? { revise: true } : {}) },
      policy,
    );

  it('one task shrinks to 1 with the weight 1/3; the pessimistic stays at 1 while the estimates are high', () => {
    expect(coefficient(ratios(0.5))).toEqual({ value: 0.794, pessimistic: 1, slice: { kind: 'overall' }, n: 1, weight: 0.333 });
  });

  it('with more tasks the coefficient moves to the median and the pessimistic one below 1', () => {
    expect(coefficient(ratios(0.41, 0.13))).toEqual({ value: 0.52, pessimistic: 0.848, slice: { kind: 'overall' }, n: 2, weight: 0.5 });
    expect(coefficient(ratios(0.41, 0.13, 0.56))).toEqual({ value: 0.586, pessimistic: 0.874, slice: { kind: 'overall' }, n: 3, weight: 0.6 });
  });

  it('low estimates: the pessimistic coefficient grows without a limit', () => {
    expect(coefficient(ratios(2))).toMatchObject({ value: 1.26, pessimistic: 2.52 });
  });

  it('without shrinking the coefficient is the median', () => {
    expect(coefficient(ratios(0.41, 0.13, 0.56), {}, CalibrationPolicy.fromConfig({ shrink: 0 }))).toMatchObject({ value: 0.41, weight: 1 });
  });

  it('no task, no coefficient', () => {
    expect(coefficient([])).toBeNull();
    expect(coefficient([syntheticCard({ id: 'T-1', author: 'someone@example.com' })])).toBeNull();
  });

  it('a task counts once however many levels hold it: the same as one level of n / (n + k)', () => {
    const one = [syntheticCard({ id: 'T-1', type: 'feature', stack: ['typescript'], ratio: 0.5 })];
    const three = [0.41, 0.13, 0.56].map((ratio, i) => syntheticCard({ id: `T-${i}`, type: 'feature', stack: ['typescript'], ratio }));
    for (const query of [{}, { stack: ['typescript'] }, { type: 'feature' }, { type: 'feature', stack: ['typescript'] }]) {
      expect(coefficient(one, query)).toMatchObject({ value: 0.794, pessimistic: 1, n: 1, weight: 0.333 });
      expect(coefficient(three, query)).toMatchObject({ value: 0.586, pessimistic: 0.874, n: 3, weight: 0.6 });
    }
    expect(coefficient(three, { type: 'feature', stack: ['typescript'] })?.slice).toEqual({ kind: 'type', key: 'feature' });
    expect(coefficient(three.slice(0, 2), { type: 'feature', stack: ['typescript'] })).toMatchObject({ value: 0.52, pessimistic: 0.848, n: 2 });
  });

  it('tasks are split between the levels: the deepest takes all of its own, each level above only the rest', () => {
    const cards = [
      syntheticCard({ id: 'T-1', type: 'feature', stack: ['javascript', 'typescript'], base: 100, ratio: 0.409 }),
      syntheticCard({ id: 'T-2', type: 'feature', stack: ['typescript'], ratio: 0.13 }),
      syntheticCard({ id: 'T-3', type: 'feature', stack: ['typescript'], ratio: 0.56 }),
      syntheticCard({ id: 'T-4', type: 'integration', stack: ['typescript'], ratio: 0.24 }),
    ];
    expect(coefficient(cards, { type: 'feature', stack: ['typescript'] })).toEqual({
      value: 0.483,
      pessimistic: 0.721,
      slice: { kind: 'type', key: 'feature' },
      n: 3,
      weight: 0.6,
    });
    expect(coefficient(cards, { type: 'integration', stack: ['typescript'] })).toEqual({
      value: 0.435,
      pessimistic: 0.869,
      slice: { kind: 'type', key: 'integration' },
      n: 1,
      weight: 0.333,
    });
    const byStack = { value: 0.473, pessimistic: 0.669, slice: { kind: 'stack', key: 'typescript' }, n: 4, weight: 0.667 };
    expect(coefficient(cards, { stack: ['typescript'] })).toEqual(byStack);
    expect(coefficient(cards, { type: 'bugfix', stack: ['typescript'] })).toEqual(byStack);
    expect(coefficient(cards, { type: 'feature', stack: ['typescript'] }, STRICT)).toBeNull();
  });

  it('levels in a chain: overall to 1, technology to overall, type to technology, each by its own tasks', () => {
    const cards = [...sample(2, { stack: ['typescript'], ratio: 0.5 }), ...sample(2, { type: 'bugfix', stack: ['go'], ratio: 2 })];
    expect(coefficient(cards)).toMatchObject({ value: 1.16, slice: { kind: 'overall' }, n: 4 });
    expect(coefficient(cards, { stack: ['typescript'] })).toMatchObject({ value: 0.841, slice: { kind: 'stack', key: 'typescript' }, n: 2 });
    expect(coefficient(cards, { type: 'feature', stack: ['typescript'] })).toEqual({
      value: 0.841,
      pessimistic: 1,
      slice: { kind: 'type', key: 'feature' },
      n: 2,
      weight: 0.5,
    });
    expect(coefficient(cards, { type: 'feature' })).toMatchObject({ value: 0.841, slice: { kind: 'type', key: 'feature' } });
    expect(coefficient(cards, { type: 'research', stack: ['go'] })).toMatchObject({ value: 1.189, slice: { kind: 'stack', key: 'go' }, n: 2 });
  });

  it('strict mode: the type first, then the technology with the most tasks, alphabetically on a tie', () => {
    const typed = [...sample(6, { stack: ['flutter'], ratio: 1.3 }), ...sample(3, { type: 'research', stack: ['flutter'], ratio: 0.8 })];
    expect(coefficient(typed, { type: 'feature', stack: ['flutter'] }, STRICT)).toMatchObject({ value: 1.3, slice: { kind: 'type', key: 'feature' }, n: 6, weight: 1 });
    const small = [
      ...sample(3, { stack: ['flutter', 'bloc'], ratio: 1.2 }),
      ...sample(4, { type: 'research', stack: ['flutter'], ratio: 1.2 }),
      ...sample(2, { type: 'bugfix', stack: ['bloc'], ratio: 1.4 }),
    ];
    expect(coefficient(small, { type: 'feature', stack: ['flutter', 'bloc'] }, STRICT)).toMatchObject({ value: 1.2, slice: { kind: 'stack', key: 'flutter' }, n: 7 });
    const tie = [...sample(2, { type: 'research', stack: ['go'], ratio: 1 }), ...sample(6, { type: 'bugfix', stack: ['flutter', 'bloc'], ratio: 1.1 })];
    expect(coefficient(tie, { type: 'research', stack: ['flutter', 'bloc'] }, STRICT)?.slice).toEqual({ kind: 'stack', key: 'bloc' });
  });

  it('strict mode applies the overall slice when the type and the technologies are small, and nothing below the threshold', () => {
    const cards = [...sample(10, { stack: ['go'], ratio: 1.2 }), ...sample(2, { type: 'research', stack: ['go'], ratio: 1 })];
    expect(coefficient(cards, { type: 'research' }, STRICT)).toMatchObject({ value: 1.2, slice: { kind: 'overall' }, n: 12 });
    expect(coefficient(cards.slice(0, 4), { type: 'feature', stack: ['go'] }, STRICT)).toBeNull();
  });

  it('strict mode gives the coefficient of the former rule wherever that rule gave one', () => {
    const types = ['feature', 'bugfix'];
    const stacks = [['go'], ['flutter'], ['go', 'flutter']];
    for (let seed = 1; seed <= 40; seed += 1) {
      const cards = Array.from({ length: 4 + (seed % 9) }, (_, i) =>
        syntheticCard({ id: `T-${i}`, type: types[(seed * (i + 1)) % 2] ?? 'feature', stack: stacks[(seed + i) % 3] ?? ['go'], ratio: 0.5 + ((seed * 7 + i * 3) % 10) / 10 }),
      );
      const author = calibrate(cards, { policy: STRICT }).authors[ME];
      for (const type of types) {
        const former = formerCoefficient(author, type, ['go', 'flutter']);
        const current = coefficient(cards, { type, stack: ['go', 'flutter'] }, STRICT);
        if (former !== null) {
          expect(current?.value).toBe(former);
        }
      }
    }
  });

  it('a revision takes the revised slice', () => {
    const revised = (i: number) =>
      syntheticCard({
        id: `T-r${i}`,
        ratio: 1.4,
        overrides: {
          revised: true,
          revisions: [{ at: '2026-10-01T12:00:00.000Z', category: 'missed-analysis', spent: 'include', typeBefore: 'feature', typeAfter: 'feature', baseLikelyBeforeHours: 10, baseLikelyAfterHours: 12.727, countedAtMinutes: 60, lostMinutes: 0 }],
          currentEstimate: { optimisticHours: 12.727, likelyHours: 12.727, pessimisticHours: 12.727, baseLikelyHours: 12.727, calibrated: false, type: 'feature' },
        },
      });
    const cards = [...Array.from({ length: 5 }, (_, i) => revised(i)), syntheticCard({ id: 'T-x', ratio: 1.4 })];
    expect(coefficient(cards, { type: 'feature' }, STRICT)?.value).toBe(1.4);
    expect(coefficient(cards, { type: 'feature', revise: true }, STRICT)).toMatchObject({ value: 1.1, slice: { kind: 'type', key: 'feature' }, n: 5 });
  });
});

/** The rule before dynamic calibration: the median of the first slice with n ≥ 5, by type, then by technology. */
function formerCoefficient(author: AuthorCalibration | undefined, type: string, stack: readonly string[]): number | null {
  const byType = author?.ratio.byType[type];
  if (byType !== undefined && byType.n >= 5) {
    return byType.median;
  }
  const best = stack
    .flatMap((key) => {
      const stats = author?.ratio.byStack[key];
      return stats !== undefined && stats.n >= 5 ? [{ key, stats }] : [];
    })
    .sort((a, b) => b.stats.n - a.stats.n || a.key.localeCompare(b.key))[0];
  return best === undefined ? null : best.stats.median;
}

describe('calibration with aliases and stack labels', () => {
  it('cards of an alias go to the author; labels in another case to one slice', () => {
    const cards = [
      ...['T-1', 'T-2', 'T-3'].map((id) => syntheticCard({ id, author: 'old@example.com', stack: ['Flutter'] })),
      ...['T-4', 'T-5'].map((id) => syntheticCard({ id, author: 'new@example.com', stack: ['flutter'] })),
    ];
    const calibration = calibrate(cards, { aliases: new Map([['old@example.com', 'new@example.com']]) });
    expect(Object.keys(calibration.authors)).toEqual(['new@example.com']);
    expect(calibration.authors['new@example.com']?.ratio.byStack['flutter']?.n).toBe(5);
  });

  it('an estimate keeps stack labels in lower case, trimmed, without repeats', () => {
    const estimate = Estimate.of({
      parts: [EstimatePart.of({ name: 'a', hours: ThreePointEstimate.of({ optimistic: 1, likely: 1, pessimistic: 1 }) })],
      stack: ['Flutter', ' bloc ', 'flutter'],
    });
    expect(estimate.stack).toEqual(['flutter', 'bloc']);
  });
});
