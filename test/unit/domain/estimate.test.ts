import { describe, expect, it } from 'vitest';
import { CodeVolume } from '../../../src/domain/estimate/code-volume.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { InvalidEstimate } from '../../../src/domain/estimate/invalid-estimate.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';

const hours = (optimistic: number, likely: number, pessimistic: number) =>
  ThreePointEstimate.of({ optimistic, likely, pessimistic });

describe('ThreePointEstimate', () => {
  it('requires optimistic ≤ likely ≤ pessimistic, non-negative, and likely > 0', () => {
    expect(hours(0, 0.25, 0.5).toData()).toEqual({ optimistic: 0, likely: 0.25, pessimistic: 0.5 });
    expect(() => hours(2, 1, 3)).toThrow('expected optimistic ≤ likely ≤ pessimistic');
    expect(() => hours(-1, 1, 3)).toThrow(InvalidValue);
    expect(() => hours(0, 0, 0)).toThrow(/likely must be greater than zero/);
  });

  it('sums quarter hours exactly', () => {
    const total = [hours(0.25, 0.75, 1.25), hours(0.5, 1.75, 2.0), hours(0.25, 0.5, 1.0)].reduce(
      (sum, h) => sum.plus(h),
      ThreePointEstimate.ZERO,
    );
    expect(total.toData()).toEqual({ optimistic: 1, likely: 3, pessimistic: 4.25 });
  });
});

describe('EstimatePart', () => {
  it('derives a kebab-case id from group and name and defaults kind to implementation', () => {
    const part = EstimatePart.of({ name: 'Auto Tests', group: 'core-model-metrics', hours: hours(1, 2, 3) });
    expect(part.id).toBe('core-model-metrics-auto-tests');
    expect(part.kind).toBe('implementation');
    expect(EstimatePart.of({ name: 'Review', hours: hours(1, 1, 1) }).id).toBe('review');
  });

  it('keeps letters of any script in the derived id', () => {
    expect(EstimatePart.of({ name: 'Анализ требований', group: 'Чейндж 2', hours: hours(1, 1, 1) }).id).toBe('чейндж-2-анализ-требований');
    expect(EstimatePart.of({ name: 'Разбор', hours: hours(1, 1, 1) }).id).not.toBe(EstimatePart.of({ name: 'Ревью', hours: hours(1, 1, 1) }).id);
  });

  it('keeps an explicit id and rejects an empty name', () => {
    expect(EstimatePart.of({ id: 'p1', name: 'x', hours: hours(1, 1, 1) }).id).toBe('p1');
    expect(() => EstimatePart.of({ name: ' ', hours: hours(1, 1, 1) })).toThrow(InvalidValue);
  });
});

describe('Estimate', () => {
  const part = (name: string, kind?: 'auto-tests' | 'manual-testing', id?: string) =>
    EstimatePart.of({ name, ...(kind ? { kind } : {}), ...(id ? { id } : {}), hours: hours(1, 2, 4) });

  it('sums the parts and knows which kinds it has', () => {
    const estimate = Estimate.of({ parts: [part('impl'), part('tests', 'auto-tests')] });
    expect(estimate.total.toData()).toEqual({ optimistic: 2, likely: 4, pessimistic: 8 });
    expect(estimate.hasKind('auto-tests')).toBe(true);
    expect(estimate.hasKind('manual-testing')).toBe(false);
    expect(estimate.calibrated).toBe(false);
  });

  it('reports every repeated id with its path', () => {
    try {
      Estimate.of({ parts: [part('a', undefined, 'x'), part('b', undefined, 'y'), part('c', undefined, 'x')] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEstimate);
      expect((error as InvalidEstimate).issues).toEqual([
        { path: 'parts[2].id', message: 'duplicate id "x" (also parts[0])' },
      ]);
    }
  });

  it('needs at least one part', () => {
    expect(() => Estimate.of({ parts: [] })).toThrow(InvalidEstimate);
  });

  it('round-trips through its data', () => {
    const estimate = Estimate.of({
      parts: [part('impl'), part('tests', 'manual-testing')],
      type: 'feature',
      stack: ['typescript'],
      codeVolume: CodeVolume.of({ production: [100, 200] }),
      rationale: 'why',
      basedOn: ['T-3'],
      calibrated: true,
    });
    expect(Estimate.fromData(estimate.toData()).toData()).toEqual(estimate.toData());
  });

  it('checks code volume ranges', () => {
    expect(() => CodeVolume.of({ tests: [300, 100] })).toThrow(/min ≤ max/);
    expect(() => CodeVolume.of({ production: [1] })).toThrow(InvalidValue);
  });
});
