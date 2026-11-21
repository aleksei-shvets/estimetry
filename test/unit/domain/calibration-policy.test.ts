import { describe, expect, it } from 'vitest';
import { CalibrationPolicy } from '../../../src/domain/calibration/calibration-policy.js';

describe('calibration policy', () => {
  it('by default applies from the first task and shrinks with k = 2', () => {
    expect(CalibrationPolicy.DEFAULT).toMatchObject({ minTasks: 1, shrink: 2 });
    expect(CalibrationPolicy.fromConfig({})).toEqual(CalibrationPolicy.DEFAULT);
  });

  it('a threshold chosen without shrink keeps the old behaviour: shrink 0', () => {
    expect(CalibrationPolicy.fromConfig({ minTasks: 5 })).toMatchObject({ minTasks: 5, shrink: 0 });
    expect(CalibrationPolicy.fromConfig({ minTasks: 5, shrink: 3 })).toMatchObject({ minTasks: 5, shrink: 3 });
    expect(CalibrationPolicy.fromConfig({ shrink: 0.5 })).toMatchObject({ minTasks: 1, shrink: 0.5 });
  });

  it('an invalid value counts as not given', () => {
    expect(CalibrationPolicy.fromConfig({ minTasks: 0 })).toEqual(CalibrationPolicy.DEFAULT);
    expect(CalibrationPolicy.fromConfig({ minTasks: 2.5, shrink: -1 })).toEqual(CalibrationPolicy.DEFAULT);
    expect(CalibrationPolicy.fromConfig({ minTasks: 5, shrink: Number.POSITIVE_INFINITY })).toMatchObject({ minTasks: 5, shrink: 0 });
  });

  it('the weight of a slice is n / (n + k) from minTasks, 0 below it', () => {
    const policy = CalibrationPolicy.DEFAULT;
    expect([0, 1, 2, 3].map((n) => policy.weight(n))).toEqual([0, 1 / 3, 0.5, 0.6]);
    const strict = CalibrationPolicy.fromConfig({ minTasks: 5 });
    expect([4, 5, 12].map((n) => strict.weight(n))).toEqual([0, 1, 1]);
    expect(CalibrationPolicy.fromConfig({ minTasks: 3, shrink: 1 }).weight(2)).toBe(0);
  });

  it('the weight of the own tasks of a level ignores the threshold, and is 0 without tasks even with k = 0', () => {
    const strict = CalibrationPolicy.fromConfig({ minTasks: 5 });
    expect([0, 1, 4].map((n) => strict.partWeight(n))).toEqual([0, 1, 1]);
    expect([0, 1, 2].map((n) => CalibrationPolicy.DEFAULT.partWeight(n))).toEqual([0, 1 / 3, 0.5]);
  });
});
