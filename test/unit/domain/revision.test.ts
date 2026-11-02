import { describe, expect, it } from 'vitest';
import { buildCard } from '../../../src/domain/card/card.js';
import { calibrate } from '../../../src/domain/calibration/calibration.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { EstimateRevision } from '../../../src/domain/estimate/estimate-revision.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { measureEffort } from '../../../src/domain/measurement/effort-calculator.js';
import { Extra } from '../../../src/domain/measurement/extra.js';
import { IdlePolicy } from '../../../src/domain/measurement/idle-policy.js';
import { Interval } from '../../../src/domain/measurement/interval.js';
import { IntervalSet } from '../../../src/domain/measurement/interval-set.js';
import { ManualTime } from '../../../src/domain/measurement/manual-time.js';
import { ParallelModeChange } from '../../../src/domain/measurement/parallel-mode.js';
import { taskPlan } from '../../../src/domain/progress/task-plan.js';
import { planProgress } from '../../../src/domain/progress/plan-progress.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import type { EventMeta } from '../../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { EstimateLocked } from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';
import { activity } from '../../support/activity.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
let seq = 0;
const meta = (time: string): EventMeta => ({ id: `e-${++seq}`, at: at(time), author: Author.of('dev@example.com') });
const api = ProjectId.parse('api');

function estimate(likely: number, groups: string[] = ['a']): Estimate {
  return Estimate.of({
    parts: groups.map((group) =>
      EstimatePart.of({ id: group, name: group, group, hours: ThreePointEstimate.of({ optimistic: likely, likely, pessimistic: likely }) }),
    ),
  });
}

function started(first: Estimate | null = estimate(10)): Task {
  const task = Task.create({ id: TaskId.fromNumber(1), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
  if (first) {
    task.saveEstimate(first, undefined, meta('08:30'));
  }
  task.start(api, meta('09:00'));
  return task;
}

const revision = (input: Partial<Parameters<typeof EstimateRevision.of>[0]> & { at: Timestamp }) =>
  EstimateRevision.of({ estimate: estimate(12), reason: 'design was wrong', category: 'missed-analysis', spent: 'exclude', ...input });

describe('revising the estimate of a task in progress', () => {
  it('keeps the first estimate, records the window of lost work and the history', () => {
    const task = started();
    task.reviseEstimate(revision({ at: at('11:00'), lostFrom: at('10:00') }), meta('12:00'));
    expect(task.estimate?.total.likely).toBe(12);
    expect(task.firstEstimate?.total.likely).toBe(10);
    expect(task.lostWindows.map((w) => [w.from.toISOString(), w.to.toISOString()])).toEqual([[at('10:00').toISOString(), at('11:00').toISOString()]]);
    expect(task.revisions[0]).toMatchObject({ category: 'missed-analysis', spent: 'exclude', baseLikelyBefore: 10, baseLikelyAfter: 12 });
    const restored = Task.fromEvents(task.pullEvents());
    expect(restored.toSnapshot()).toEqual(Task.rehydrate(task.toSnapshot()).toSnapshot());
  });

  it('a window defaults to the start, then to the previous revision; include after exclude keeps the earlier window', () => {
    const task = started();
    task.reviseEstimate(revision({ at: at('10:00') }), meta('10:00'));
    task.reviseEstimate(revision({ spent: 'include', at: at('11:00') }), meta('11:00'));
    task.reviseEstimate(revision({ at: at('12:00') }), meta('12:00'));
    expect(task.lostWindows.map((w) => [w.from.toISOString(), w.to.toISOString()])).toEqual([
      [at('09:00').toISOString(), at('10:00').toISOString()],
      [at('11:00').toISOString(), at('12:00').toISOString()],
    ]);
  });

  it('refuses a revision in parallel mode, before what refers to the old plan, without --spent, or with an empty window', () => {
    const task = started();
    task.enableParallelMode(ParallelModeChange.of({ parts: ['a'] }), meta('09:30'));
    expect(() => task.reviseEstimate(revision({ at: at('10:00') }), meta('10:00'))).toThrow(/parallel off/);
    task.disableParallelMode(meta('10:30'));
    expect(() => task.reviseEstimate(revision({ at: at('10:00') }), meta('11:00'))).toThrow(/end of parallel mode/);
    task.recordManualTime(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(10), description: 'test', part: 'a' }), meta('11:00'));
    expect(() => task.reviseEstimate(revision({ at: at('10:45') }), meta('11:30'))).toThrow(/manual time of an estimate part/);
    expect(() => task.reviseEstimate(EstimateRevision.of({ estimate: estimate(12), reason: 'x', at: at('11:10') }), meta('11:30'))).toThrow(/--spent/);
    expect(() => task.reviseEstimate(revision({ at: at('11:10'), lostFrom: at('11:10') }), meta('11:30'))).toThrow(/empty/);
    expect(() => EstimateRevision.of({ estimate: estimate(1), reason: 'x', spent: 'include', lostFrom: at('10:00'), at: at('11:00') })).toThrow(InvalidValue);
    expect(() => EstimateRevision.of({ estimate: estimate(1), reason: 'x'.repeat(501), at: at('11:00') })).toThrow(/500/);
  });

  it('refuses --covers of extra work the task does not have, and keeps the confirmed ones', () => {
    const task = started();
    task.recordExtra(Extra.of({ category: 'missed-analysis', description: 'rolled back', time: Duration.ofMinutes(90) }), meta('10:30'));
    const id = task.extraRecords[0]?.id as string;
    expect(() => task.reviseEstimate(revision({ at: at('11:00'), covers: ['nope'] }), meta('11:00'))).toThrow(/nope/);
    task.reviseEstimate(revision({ at: at('11:00'), covers: [id] }), meta('11:00'));
    expect(task.revisions[0]?.covers).toEqual([id]);
  });

  it('a task started without an estimate gets one, marked, without history', () => {
    const task = started(null);
    task.reviseEstimate(EstimateRevision.of({ estimate: estimate(5), reason: 'first estimate', at: at('10:00') }), meta('10:00'));
    expect(task).toMatchObject({ estimatedAfterStart: true, firstEstimate: undefined, revisions: [] });
    expect(task.estimate?.total.likely).toBe(5);
  });

  it('after a reopening the window of lost work starts there by default', () => {
    const task = started();
    task.close({ at: at('10:00'), outcome: 'completed' }, meta('10:00'));
    task.reopen(meta('13:00'));
    task.reviseEstimate(revision({ at: at('14:00') }), meta('14:00'));
    expect(task.lostWindows[0]?.from.toISOString()).toBe(at('13:00').toISOString());
  });

  it('a first estimate refuses the options of a revision', () => {
    const task = started(null);
    expect(() => task.reviseEstimate(EstimateRevision.of({ estimate: estimate(5), reason: 'x', spent: 'include', at: at('10:00') }), meta('10:00'))).toThrow(
      /first one/,
    );
  });

  it('estimate save after the start names revise', () => {
    expect(() => started().saveEstimate(estimate(3), undefined, meta('10:00'))).toThrow(EstimateLocked);
    expect(() => started().saveEstimate(estimate(3), undefined, meta('10:00'))).toThrow(/emt estimate revise/);
  });
});

describe('the fact without lost windows', () => {
  const policy = IdlePolicy.ofMinutes(30);
  const base = { startedAt: at('09:00'), parallel: [], policy, now: at('12:00') };
  const turn = [
    activity('turn.started', '09:00', { origin: 'user' }),
    activity('tool.started', '09:00', { toolUseId: 't1' }),
    activity('tool.used', '09:20', { toolUseId: 't1' }),
    activity('tool.started', '09:20', { toolUseId: 't2' }),
    activity('tool.used', '09:40', { toolUseId: 't2' }),
    activity('turn.ended', '09:40'),
  ];
  const lost = IntervalSet.of([Interval.of(at('09:10'), at('09:30'))]);

  it('takes the window out of agent time and agent work; counted never exceeds the whole', () => {
    const total = measureEffort({ ...base, activity: turn, manual: [] });
    const counted = measureEffort({ ...base, activity: turn, manual: [], lost });
    expect(total.agentTime.minutes).toBe(40);
    expect(counted.agentTime.minutes).toBe(20);
    expect(counted.agentWork.minutes).toBe(20);
    expect(counted.fact.millis).toBeLessThanOrEqual(total.fact.millis);
  });

  it('cuts manual time with a moment as an interval and keeps manual time without one', () => {
    const manual = [
      ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(40), description: 'call', at: at('09:40') }),
      ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(20), description: 'review yesterday' }),
    ];
    const counted = measureEffort({ ...base, activity: [], manual, lost });
    // 40 minutes 09:00–09:40 minus the window 09:10–09:30 is 20, plus 20 without a moment.
    expect(counted.userTime.minutes).toBe(40);
  });
});

describe('the plan after a revision with exclude', () => {
  const plan = (exclusions: Parameters<typeof taskPlan>[2]) =>
    taskPlan(
      [{ project: 'api', changes: [{ change: 'auth', archived: true, archivedOn: '2026-10-27', done: 3, total: 3 }, { change: 'billing', archived: false, done: 0, total: 2 }] }],
      at('09:00'),
      exclusions,
    );

  it('leaves out a change rolled back the same day and names its group', () => {
    const exclusions = { archives: [{ project: 'api', change: 'auth', archivedOn: '2026-10-27' }], read: [{ at: at('11:00').toISOString(), projects: ['api'] }] };
    const progress = planProgress(estimate(5, ['auth', 'billing']), plan(exclusions));
    expect(progress).toMatchObject({ done: 0, archivedBeforeRevision: ['auth'], notStarted: [] });
    expect(planProgress(estimate(5, ['auth', 'billing']), plan(undefined))?.done).toBe(50);
  });

  it('a change rolled back and archived again the same day counts again: its directory changed later', () => {
    const exclusions = {
      archives: [{ project: 'api', change: 'auth', archivedOn: '2026-10-27', changedAt: at('10:30').toMillis() }],
      read: [{ at: at('11:00').toISOString(), projects: ['api'] }],
    };
    const again = taskPlan(
      [{ project: 'api', changes: [{ change: 'auth', archived: true, archivedOn: '2026-10-27', done: 3, total: 3, changedAt: at('16:00').toMillis() }] }],
      at('09:00'),
      exclusions,
    );
    expect(again.archivedBeforeRevision.size).toBe(0);
    expect(again.changes.map((c) => c.change)).toEqual(['auth']);
  });

  it('counts the change again once it is archived anew', () => {
    const exclusions = { archives: [{ project: 'api', change: 'auth', archivedOn: '2026-10-25' }], read: [{ at: at('11:00').toISOString(), projects: ['api'] }] };
    expect(planProgress(estimate(5, ['auth', 'billing']), plan(exclusions))?.done).toBe(50);
  });

  it('a project not listed at the revision counts its archive from the day of the revision', () => {
    const exclusions = { archives: [], read: [{ at: Timestamp.parse('2026-10-30T11:00:00.000Z').toISOString(), projects: ['web'] }] };
    expect(plan(exclusions).archivedBeforeRevision.has('auth')).toBe(true);
  });
});

describe('card and calibration of a revised task', () => {
  const report = (minutes: number) => measureEffort({ activity: [], startedAt: at('09:00'), manual: [ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(minutes), description: 'x' })], parallel: [], policy: IdlePolicy.ofMinutes(30), now: at('18:00') });

  it('carries the first estimate, so the ratio stays fact over the first estimate', () => {
    const task = started(estimate(10));
    task.reviseEstimate(revision({ at: at('11:00') }), meta('11:00'));
    task.close({ at: at('18:00'), outcome: 'completed' }, meta('18:00'));
    const card = buildCard({ task, report: report(14 * 60), partFacts: { mode: 'by-checkboxes', parts: [{ minutes: 1 }], unattributed: 0, beforeRevision: 0 }, records: [], hasActivity: true });
    expect(card).toMatchObject({ revised: true, estimate: { likelyHours: 10 }, partsFact: 'by-checkboxes', parts: [{ factMinutes: null, reason: 'revised' }], currentParts: [{ factMinutes: 1 }] });
    expect(calibrate([card]).authors['dev@example.com']?.ratio.overall.median).toBe(1.4);
  });

  it('leaves out a task estimated only after its start and a renegotiated original with revisions', () => {
    const late = started(null);
    late.reviseEstimate(EstimateRevision.of({ estimate: estimate(5), reason: 'first', at: at('10:00') }), meta('10:00'));
    late.close({ at: at('18:00'), outcome: 'completed' }, meta('18:00'));
    const renegotiated = started(estimate(10));
    renegotiated.reviseEstimate(revision({ at: at('11:00') }), meta('11:00'));
    renegotiated.renegotiate({ at: at('18:00'), spawned: TaskId.fromNumber(9), category: 'new-requirement', description: 'more' }, { next: () => meta('18:00') });
    const cards = [late, renegotiated].map((task) =>
      buildCard({ task, report: report(300), partFacts: { mode: 'no-plan-snapshots', parts: [], unattributed: 300, beforeRevision: 0 }, records: [], hasActivity: true }),
    );
    expect(calibrate(cards).authors['dev@example.com']?.ratio.overall).toMatchObject({
      n: 0,
      excluded: { 'estimated-after-start': 1, 'renegotiated-after-revision': 1 },
    });
  });
});
