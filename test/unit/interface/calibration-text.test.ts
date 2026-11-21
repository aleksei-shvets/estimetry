import { describe, expect, it } from 'vitest';
import type { CalibrationView } from '../../../src/application/task/show-calibration.js';
import type { RatioStats } from '../../../src/domain/calibration/calibration.js';
import { calibrationText, estimateText } from '../../../src/interface/cli/presenters/text/estimate-text.js';

const stats = (n: number, weight: number, median: number | null = n === 0 ? null : 0.41): RatioStats => ({
  n,
  median,
  mean: median,
  weight,
  excluded: {},
  uncertain: 0,
  backgroundAgents: 0,
  revised: 0,
});

function view(overrides: Partial<CalibrationView> & { readonly overall?: RatioStats } = {}): CalibrationView {
  const { overall = stats(3, 0.6), ...rest } = overrides;
  const revised = { ...stats(0, 0), countedAtShare: null };
  return {
    schemaVersion: 2,
    query: { type: 'feature', stack: [], revise: false },
    coefficient: null,
    minTasks: 1,
    shrink: 2,
    tasks: overall.n,
    ratio: { overall, byType: { feature: overall }, byStack: {} },
    revised: { overall: revised, byType: { feature: revised }, byStack: {} },
    revisions: {},
    extras: {},
    missedScope: null,
    linesPerHour: {},
    codeVolume: null,
    parts: {},
    skipped: [],
    otherAuthors: 0,
    ...rest,
  };
}

const firstLine = (text: string) => text.split('\n')[0];

describe('emt calibrate text', () => {
  it('names the coefficient with its tasks, weight, slice and the pessimistic one', () => {
    const text = calibrationText(
      view({ coefficient: { value: 0.586, pessimistic: 0.874, slice: { kind: 'type', key: 'feature' }, n: 3, weight: 0.6 } }),
    );
    expect(firstLine(text)).toBe(
      'Coefficient ×0.59 from 3 tasks (weight 60%), slice type feature; pessimistic ×0.87 (first estimates): ' +
        'multiply the optimistic and most likely hours of every part by ×0.59, the pessimistic hours by ×0.87.',
    );
    expect(text).toMatch(/overall\s+3 tasks, median ×0\.41, mean ×0\.41, weight 60%/);
  });

  it('names the overall slice without a key', () => {
    const text = calibrationText(view({ coefficient: { value: 0.794, pessimistic: 1, slice: { kind: 'overall' }, n: 1, weight: 0.333 } }));
    expect(firstLine(text)).toMatch(/^Coefficient ×0\.79 from 1 task \(weight 33%\), slice overall; pessimistic ×1 \(first estimates\)/);
  });

  it('without a closed task, with every task left out, and below the threshold', () => {
    expect(firstLine(calibrationText(view({ overall: stats(0, 0), tasks: 0 })))).toBe('Without calibration: no closed task yet.');
    expect(firstLine(calibrationText(view({ overall: stats(0, 0), tasks: 2 })))).toBe(
      'Without calibration: none of the closed tasks counts (see what is left out below).',
    );
    expect(firstLine(calibrationText(view({ overall: stats(0, 0), tasks: 2, query: { type: 'feature', stack: [], revise: true } })))).toBe(
      'Without calibration: no revised task counts yet.',
    );
    const strict = calibrationText(view({ overall: stats(2, 0), minTasks: 5, shrink: 0 }));
    expect(firstLine(strict)).toBe('Without calibration: 2 of 5 tasks needed (calibration.minTasks).');
    expect(strict).toMatch(/overall\s+2 tasks, median ×0\.41, mean ×0\.41, too few to apply/);
  });
});

describe('estimate text', () => {
  const parts = [{ id: 'a', name: 'a', kind: 'implementation' as const, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }];

  it('names both coefficients of a calibrated estimate', () => {
    const text = estimateText({ schemaVersion: 1, parts, calibrated: true, calibration: { coefficient: 0.59, pessimistic: 0.87 } });
    expect(text).toMatch(/^estimate\s+1 \/ 2 \/ 3 h \(calibrated ×0\.59, pessimistic ×0\.87\)/);
    expect(estimateText({ schemaVersion: 1, parts, calibrated: true, calibration: { coefficient: 1.3 } })).toMatch(/\(calibrated ×1\.3\)/);
  });
});
