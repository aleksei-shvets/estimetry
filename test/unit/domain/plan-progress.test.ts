import { describe, expect, it } from 'vitest';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { planProgress } from '../../../src/domain/progress/plan-progress.js';
import type { ChangeProgress } from '../../../src/domain/progress/progress-records.js';
import { taskPlan, type ProjectPlan } from '../../../src/domain/progress/task-plan.js';
import { CalendarDate } from '../../../src/domain/shared/calendar-date.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';

const START = Timestamp.parse('2026-10-26T18:57:00.000Z');
const active = (change: string, done: number, total: number): ChangeProgress => ({ change, archived: false, done, total });
const archived = (change: string, on: string, done = 5, total = 5): ChangeProgress => ({ change, archived: true, archivedOn: on, done, total });
const plan = (changes: ChangeProgress[], project = 'api', start = START) => taskPlan([{ project, changes }], start);

function estimate(parts: { group?: string; likely: number }[]): Estimate {
  return Estimate.of({
    parts: parts.map((p, i) =>
      EstimatePart.of({
        id: `p${i}`,
        name: `part ${i}`,
        ...(p.group === undefined ? {} : { group: p.group }),
        hours: ThreePointEstimate.of({ optimistic: p.likely, likely: p.likely, pessimistic: p.likely }),
      }),
    ),
  });
}

describe('CalendarDate', () => {
  it('parses real dates only, moves by days and takes the UTC day of a moment', () => {
    expect(CalendarDate.parse('2026-02-28').minusDays(-1).value).toBe('2026-03-01');
    expect(() => CalendarDate.parse('2026-02-30')).toThrow(InvalidValue);
    expect(() => CalendarDate.parse('26-10-01')).toThrow(InvalidValue);
    expect(CalendarDate.of(Timestamp.parse('2026-10-26T23:30:00.000Z')).value).toBe('2026-10-26');
    expect(CalendarDate.parse('2026-10-25').isBefore(CalendarDate.parse('2026-10-26'))).toBe(true);
  });
});

describe('the plan of a task', () => {
  it('leaves out archives older than the day before the start', () => {
    const p = plan([archived('auth', '2026-09-01'), archived('auth-v2', '2026-10-25')]);
    expect(p.changes.map((c) => c.change)).toEqual(['auth-v2']);
    expect([...p.archivedBeforeStart]).toEqual(['auth']);
  });

  it('keeps the day before the start and drops the one before that', () => {
    const p = plan([archived('a', '2026-10-25'), archived('b', '2026-10-24')], 'api', Timestamp.parse('2026-10-26T00:30:00.000Z'));
    expect(p.changes.map((c) => c.change)).toEqual(['a']);
  });

  it('prefers the active change and the latest archive of one name', () => {
    expect(plan([archived('auth', '2026-10-27'), active('auth', 1, 3)]).changes).toEqual([{ ...active('auth', 1, 3), project: 'api' }]);
    expect(plan([archived('auth', '2026-10-30'), archived('auth', '2026-10-27')]).changes[0]?.archivedOn).toBe('2026-10-30');
  });

  it('collects changes of every project of the task, each with its project', () => {
    const projects: ProjectPlan[] = [
      { project: 'api', changes: [active('payments', 1, 2)] },
      { project: 'web', changes: [active('payments', 2, 2)] },
    ];
    expect(taskPlan(projects, START).changes.map((c) => `${c.project}/${c.change}`)).toEqual(['api/payments', 'web/payments']);
  });
});

describe('plan progress', () => {
  it('weights the parts by their most likely hours', () => {
    const p = plan([archived('a', '2026-10-27', 2, 5), active('b', 1, 4)]);
    expect(planProgress(estimate([{ group: 'a', likely: 4 }, { group: 'b', likely: 12 }, { likely: 4 }]), p)).toMatchObject({
      done: 43,
      mode: 'changes',
      groupedHours: 16,
      estimateHours: 20,
    });
  });

  it('names groups without a change: not started, possible typo, archived before start', () => {
    const p = plan([archived('core-model-metrics', '2026-10-28'), archived('bootstrap-cli-storage', '2026-10-27'), archived('legacy', '2026-01-01')]);
    const result = planProgress(
      estimate([
        { group: 'core-model-metrics', likely: 4 },
        { group: 'close-retro-cards', likely: 9 },
        { group: 'bootsrap-cli-storage', likely: 1 },
        { group: 'legacy', likely: 1 },
      ]),
      p,
    );
    expect(result).toMatchObject({
      done: 26, // 4 of 15
      notStarted: ['close-retro-cards'],
      possibleTypos: [{ group: 'bootsrap-cli-storage', similar: 'bootstrap-cli-storage' }],
      archivedBeforeStart: ['legacy'],
    });
  });

  it('no typo for a change that is a group of its own, nor for short different names', () => {
    const p = plan([active('auth-v1', 1, 2), active('db', 1, 1)]);
    const result = planProgress(
      estimate([
        { group: 'auth-v1', likely: 2 },
        { group: 'auth-v2', likely: 2 },
        { group: 'ui', likely: 1 },
      ]),
      p,
    );
    expect(result).toMatchObject({ notStarted: ['auth-v2', 'ui'], possibleTypos: [] });
  });

  it('with groups but none of their changes yet is 0%, whatever other changes the project has', () => {
    expect(planProgress(estimate([{ group: 'mine', likely: 5 }]), plan([active('someone-else', 7, 10)]))).toMatchObject({ done: 0, mode: 'changes', notStarted: ['mine'] });
  });

  it('without an estimate or groups counts checkboxes, archives as done', () => {
    const p = plan([active('a', 3, 10), archived('b', '2026-10-27', 0, 5)]);
    expect(planProgress(undefined, p)).toMatchObject({ done: 53, mode: 'checkboxes' });
    expect(planProgress(estimate([{ likely: 3 }]), p)?.mode).toBe('checkboxes');
    expect(planProgress(undefined, plan([active('empty', 0, 0)]))).toBeUndefined();
  });

  it('rounds down with room for floating point', () => {
    expect(planProgress(undefined, plan([active('a', 29, 50)]))?.done).toBe(58);
    expect(planProgress(undefined, plan([active('a', 999, 1000)]))?.done).toBe(99);
    expect(planProgress(undefined, plan([active('a', 5, 5)]))?.done).toBe(100);
  });

  it('a group with changes in two projects is done when both are archived', () => {
    const projects: ProjectPlan[] = [
      { project: 'api', changes: [archived('payments', '2026-10-27')] },
      { project: 'web', changes: [active('payments', 1, 4)] },
    ];
    expect(planProgress(estimate([{ group: 'payments', likely: 2 }]), taskPlan(projects, START))?.done).toBe(66); // 6 of 9 boxes
  });

  it('gives 51% on the shape of the estimetry v1 plan', () => {
    // Synthetic copy of the real task: eight changes as groups, four archived since the start.
    const groups: [string, number][] = [
      ['bootstrap-cli-storage', 4],
      ['core-model-metrics', 7],
      ['claude-code-init', 7],
      ['hooks-and-flows', 12],
      ['close-retro-cards', 9.25],
      ['estimate-mode', 9],
      ['session-log-importer', 6.25],
      ['release', 4],
    ];
    const p = plan([
      archived('bootstrap-cli-storage', '2026-10-27', 35, 35),
      archived('core-model-metrics', '2026-10-28', 31, 31),
      archived('claude-code-init', '2026-10-30', 35, 35),
      archived('hooks-and-flows', '2026-11-01', 36, 36),
      active('plan-progress', 0, 27),
    ]);
    expect(planProgress(estimate(groups.map(([group, likely]) => ({ group, likely }))), p)).toMatchObject({
      done: 51,
      groupedHours: 58.5,
      notStarted: ['close-retro-cards', 'estimate-mode', 'session-log-importer', 'release'],
    });
  });
});
