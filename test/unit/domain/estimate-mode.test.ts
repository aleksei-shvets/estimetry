import { describe, expect, it } from 'vitest';
import { applicableCoefficient } from '../../../src/domain/calibration/applicable-coefficient.js';
import { calibrate } from '../../../src/domain/calibration/calibration.js';
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
    const result = similarTasks(cards, { author: ME, type: 'feature', stack: ['flutter', 'bloc'] });
    expect(result.map((r) => [r.card.task.id, r.score])).toEqual([['T-1', 1], ['T-2', 0.375]]);
    expect(result[0]?.matched).toEqual({ stack: { common: ['flutter', 'bloc'], share: 1 }, type: true });
  });

  it('size counts with --hours and only for a card with an estimate', () => {
    const sized = similarTasks([syntheticCard({ id: 'T-1', base: 20 })], { author: ME, type: 'feature', stack: [], hours: 10 });
    expect(sized[0]).toMatchObject({ score: 0.8, matched: { size: { ratio: 2, share: 0.5 } } });
    const unestimated = similarTasks([syntheticCard({ id: 'T-1', base: null, factHours: 40 })], { author: ME, type: 'feature', stack: [], hours: 10 });
    expect(unestimated[0]).toMatchObject({ score: 1, matched: { type: true } });
    expect(unestimated[0]?.matched.size).toBeUndefined();
  });

  it('compares labels in lower case and leaves out a card without labels from the stack component', () => {
    const result = similarTasks([syntheticCard({ id: 'T-1', stack: ['flutter'] }), syntheticCard({ id: 'T-2', stack: [] })], {
      author: ME,
      type: 'feature',
      stack: ['Flutter'],
    });
    expect(result.map((r) => [r.card.task.id, r.score])).toEqual([['T-1', 1], ['T-2', 1]]);
    expect(result[1]?.matched.stack).toBeUndefined();
  });

  it('takes the type of the first estimate', () => {
    const revised = syntheticCard({ id: 'T-1', overrides: { currentEstimate: { ...syntheticCard({ id: 'x' }).estimate!, type: 'research' } } });
    expect(similarTasks([revised], { author: ME, type: 'feature', stack: ['go'] })[0]?.matched.type).toBe(true);
  });

  it('leaves out tasks sharing nothing, abandoned ones and those of other authors; aliases count', () => {
    const cards = [
      syntheticCard({ id: 'T-1', type: 'feature', stack: ['flutter'] }),
      syntheticCard({ id: 'T-2', type: 'research', stack: ['go'], outcome: 'abandoned' }),
      syntheticCard({ id: 'T-3', type: 'research', author: 'other@example.com' }),
      syntheticCard({ id: 'T-4', type: 'research', author: 'old@example.com' }),
    ];
    const result = similarTasks(cards, { author: ME, aliases: new Map([['old@example.com', ME]]), type: 'research', stack: ['go'] });
    expect(ids(result)).toEqual(['T-4']);
  });

  it('orders equal scores by the later closing and keeps the limit', () => {
    const cards = [1, 5, 3].map((day) => syntheticCard({ id: `T-${day}`, closedAt: `2026-11-0${day}T10:00:00.000Z` }));
    expect(ids(similarTasks(cards, { author: ME, type: 'feature', stack: [], limit: 2 }))).toEqual(['T-5', 'T-3']);
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
    const result = similarTasks([renegotiated, late], { author: ME, type: 'feature', stack: [] });
    expect(result.find((r) => r.card.task.id === 'T-1')?.ratio).toEqual({ ratio: 1.25 });
    expect(result.find((r) => r.card.task.id === 'T-2')?.ratio).toEqual({ excluded: 'estimated-after-start' });
  });
});

describe('applicable coefficient', () => {
  const sample = (n: number, spec: { type?: string; stack: string[]; ratio: number }) =>
    Array.from({ length: n }, (_, i) => syntheticCard({ id: `T-${spec.type ?? 'f'}-${spec.stack.join('')}-${i}`, type: spec.type ?? 'feature', stack: spec.stack, ratio: spec.ratio }));
  const authorOf = (cards: ReturnType<typeof sample>) => calibrate(cards, { minTasks: 5 }).authors[ME];

  it('takes the slice by type first', () => {
    const author = authorOf([...sample(6, { stack: ['flutter'], ratio: 1.3 }), ...sample(3, { type: 'research', stack: ['flutter'], ratio: 0.8 })]);
    expect(applicableCoefficient(author, { type: 'feature', stack: ['flutter'] })).toEqual({ value: 1.3, slice: { kind: 'type', key: 'feature' }, n: 6 });
  });

  it('a small type falls back to the technology with the most tasks, alphabetically on a tie', () => {
    const author = authorOf([
      ...sample(3, { stack: ['flutter', 'bloc'], ratio: 1.2 }),
      ...sample(4, { type: 'research', stack: ['flutter'], ratio: 1.2 }),
      ...sample(2, { type: 'bugfix', stack: ['bloc'], ratio: 1.4 }),
    ]);
    expect(applicableCoefficient(author, { type: 'feature', stack: ['flutter', 'bloc'] })).toEqual({ value: 1.2, slice: { kind: 'stack', key: 'flutter' }, n: 7 });
    const tie = authorOf([...sample(2, { type: 'research', stack: ['go'], ratio: 1 }), ...sample(6, { type: 'bugfix', stack: ['flutter', 'bloc'], ratio: 1.1 })]);
    expect(applicableCoefficient(tie, { type: 'research', stack: ['flutter', 'bloc'] })?.slice).toEqual({ kind: 'stack', key: 'bloc' });
  });

  it('never applies the overall slice', () => {
    const author = authorOf([...sample(10, { stack: ['go'], ratio: 1.2 }), ...sample(2, { type: 'research', stack: ['go'], ratio: 1 })]);
    expect(author?.ratio.overall.n).toBe(12);
    expect(applicableCoefficient(author, { type: 'research', stack: [] })).toBeNull();
    expect(applicableCoefficient(undefined, { type: 'research', stack: [] })).toBeNull();
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
    const author = calibrate([...Array.from({ length: 5 }, (_, i) => revised(i)), syntheticCard({ id: 'T-x', ratio: 1.4 })], { minTasks: 5 }).authors[ME];
    expect(applicableCoefficient(author, { type: 'feature', stack: [] })?.value).toBe(1.4);
    expect(applicableCoefficient(author, { type: 'feature', stack: [], revise: true })).toEqual({ value: 1.1, slice: { kind: 'type', key: 'feature' }, n: 5 });
  });
});

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
