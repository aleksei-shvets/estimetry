import { describe, expect, it } from 'vitest';
import { revisionFacts } from '../../../src/domain/card/revision-facts.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { EstimateQuery } from '../../../src/domain/card/estimate-query.js';
import { EstimateRevision } from '../../../src/domain/estimate/estimate-revision.js';
import { LostWindow } from '../../../src/domain/estimate/lost-window.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { measureEffort } from '../../../src/domain/measurement/effort-calculator.js';
import type { EffortReport } from '../../../src/domain/measurement/effort-report.js';
import { Extra } from '../../../src/domain/measurement/extra.js';
import { IdlePolicy } from '../../../src/domain/measurement/idle-policy.js';
import { ManualTime } from '../../../src/domain/measurement/manual-time.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { CalendarDate } from '../../../src/domain/shared/calendar-date.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import type { EventMeta } from '../../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { revisionCandidates } from '../../../src/domain/task/revision-candidates.js';
import { Task } from '../../../src/domain/task/task.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';

const at = (hhmm: string, day = '27') => Timestamp.parse(`2026-10-${day}T${hhmm}:00.000Z`);
const ms = (moment: Timestamp, delta: number) => moment.toMillis() + delta;
const date = (value: string) => CalendarDate.parse(value);
let seq = 0;
const meta = (time: string): EventMeta => ({ id: `e-${++seq}`, at: at(time), author: Author.of('dev@example.com') });
const api = ProjectId.parse('api');

function estimate(likely: number): Estimate {
  return Estimate.of({ parts: [EstimatePart.of({ id: 'a', name: 'a', group: 'a', hours: ThreePointEstimate.of({ optimistic: likely, likely, pessimistic: likely }) })] });
}

function started(): Task {
  const task = Task.create({ id: TaskId.fromNumber(1), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
  task.saveEstimate(estimate(10), undefined, meta('08:30'));
  task.start(api, meta('09:00'));
  return task;
}

describe('the window of lost work', () => {
  const window = LostWindow.of(at('10:00'), at('11:00'));

  it('does not end before it starts; between gives nothing for such a window', () => {
    expect(() => LostWindow.of(at('11:00'), at('10:00'))).toThrow(InvalidValue);
    expect(LostWindow.between(at('11:00'), at('10:00'))).toBeUndefined();
    expect(LostWindow.between(at('10:00'), at('10:00'))?.contains(at('10:00'))).toBe(true);
  });

  it('holds both of its ends', () => {
    expect(window.contains(at('10:00'))).toBe(true);
    expect(window.contains(at('11:00'))).toBe(true);
    expect(window.contains(Timestamp.fromMillis(ms(at('10:00'), -1)))).toBe(false);
    expect(window.contains(Timestamp.fromMillis(ms(at('11:00'), 1)))).toBe(false);
  });

  it('has ended by its end and after it, not before', () => {
    expect(window.endsBy(at('11:00'))).toBe(true);
    expect(window.endsBy(at('12:00'))).toBe(true);
    expect(window.endsBy(at('10:59'))).toBe(false);
  });

  it('is an interval of the same moments', () => {
    const interval = window.interval();
    expect([interval.start.toISOString(), interval.end.toISOString()]).toEqual([at('10:00').toISOString(), at('11:00').toISOString()]);
  });

  it('holds an archive by the time its directory changed, give or take a second', () => {
    const archive = (changedAt: number) => window.holdsArchive({ archivedOn: date('2026-10-01'), changedAt });
    expect(archive(ms(at('10:00'), -1_000))).toBe(true);
    expect(archive(ms(at('10:00'), -1_001))).toBe(false);
    expect(archive(ms(at('11:00'), 1_000))).toBe(true);
    expect(archive(ms(at('11:00'), 1_001))).toBe(false);
  });

  it('without the time of the directory, by the date: from the day before the window to the day it ends', () => {
    const late = LostWindow.of(at('10:00', '27'), at('09:00', '29'));
    for (const changedAt of [undefined, 0]) {
      const archive = (day: string) => late.holdsArchive({ archivedOn: date(day), ...(changedAt === undefined ? {} : { changedAt }) });
      expect(archive('2026-10-25')).toBe(false);
      expect(archive('2026-10-26')).toBe(true);
      expect(archive('2026-10-29')).toBe(true);
      expect(archive('2026-10-30')).toBe(false);
    }
  });
});

describe('candidates of a revision', () => {
  it('extra work recorded inside the window, on its ends too', () => {
    const task = started();
    task.recordExtra(Extra.of({ category: 'missed-analysis', description: 'before' }), meta('09:59'));
    task.recordExtra(Extra.of({ category: 'missed-analysis', description: 'at the start' }), meta('10:00'));
    task.recordExtra(Extra.of({ category: 'rework', description: 'at the end' }), meta('11:00'));
    task.recordExtra(Extra.of({ category: 'rework', description: 'after' }), meta('11:01'));
    const found = revisionCandidates(task, LostWindow.of(at('10:00'), at('11:00')));
    expect(found.extras.map((record) => record.extra.description)).toEqual(['at the start', 'at the end']);
    expect(found.extras.map((record) => record.at.toISOString())).toEqual([at('10:00').toISOString(), at('11:00').toISOString()]);
  });

  it('manual time without a moment, recorded inside the window; timed manual time is taken out by the window itself', () => {
    const task = started();
    task.recordManualTime(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(10), description: 'untimed' }), meta('10:30'));
    task.recordManualTime(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(10), description: 'timed', at: at('10:20') }), meta('10:40'));
    task.recordManualTime(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(10), description: 'untimed later' }), meta('11:30'));
    const found = revisionCandidates(task, LostWindow.of(at('10:00'), at('11:00')));
    expect(found.untimedManual.map((manual) => manual.description)).toEqual(['untimed']);
  });
});

describe('facts of revisions', () => {
  const report = (minutes: number): EffortReport =>
    measureEffort({
      activity: [],
      startedAt: at('09:00'),
      manual: [ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(minutes), description: 'x' })],
      parallel: [],
      policy: IdlePolicy.ofMinutes(30),
      now: at('18:00'),
    });
  const revise = (spent: 'exclude' | 'include') =>
    EstimateRevision.of({
      estimate: estimate(12),
      reason: 'design was wrong',
      category: 'missed-analysis',
      spent,
      at: at('11:00'),
      ...(spent === 'exclude' ? { lostFrom: at('10:00') } : {}),
    });

  it('the counted fact at the revision; a revision that counts the work loses nothing', () => {
    const task = started();
    task.reviseEstimate(revise('include'), meta('11:00'));
    const facts = revisionFacts(task.revisions, { report: report(120), countedAt: () => report(50.4), without: () => report(0) });
    expect(facts).toEqual([{ countedAtMinutes: 50, lostMinutes: 0 }]);
  });

  it('the lost work is the fact with the window less the fact without it, never below zero', () => {
    const task = started();
    task.reviseEstimate(revise('exclude'), meta('11:00'));
    const windows: string[] = [];
    const without = (minutes: number) => (window: LostWindow) => {
      windows.push(`${window.from.toISOString()}..${window.to.toISOString()}`);
      return report(minutes);
    };
    expect(revisionFacts(task.revisions, { report: report(120), countedAt: () => report(60), without: without(80) })).toEqual([{ countedAtMinutes: 60, lostMinutes: 40 }]);
    expect(revisionFacts(task.revisions, { report: report(120), countedAt: () => report(60), without: without(130) })).toEqual([{ countedAtMinutes: 60, lostMinutes: 0 }]);
    expect(windows).toEqual(Array(2).fill(`${at('10:00').toISOString()}..${at('11:00').toISOString()}`));
  });

  it('in parallel mode the sequential equivalent is compared', () => {
    const task = started();
    task.reviseEstimate(revise('exclude'), meta('11:00'));
    const parallel = (fact: number, sequential: number): EffortReport => ({
      ...report(fact),
      parallel: { used: true, maxAgents: 2 },
      sequentialEquivalent: Duration.ofMinutes(sequential),
    });
    const facts = revisionFacts(task.revisions, { report: parallel(100, 200), countedAt: () => report(60), without: () => parallel(90, 150) });
    expect(facts).toEqual([{ countedAtMinutes: 60, lostMinutes: 50 }]);
  });
});

describe('the query of an estimate', () => {
  it('keeps the checked type and compares labels as stackLabels gives them', () => {
    const type = TaskType.of('feature', DEFAULT_TASK_TYPES);
    const query = EstimateQuery.of({ type, stack: [' Flutter', 'flutter', '', 'Dart '] });
    expect(query.type).toBe(type);
    expect(query.stack.values).toEqual(['flutter', 'dart']);
    expect(query.stack.isEmpty).toBe(false);
    expect(query.stack.commonWith(['dart', 'go'])).toEqual(['dart']);
    expect(EstimateQuery.of({ stack: [' '] }).stack.isEmpty).toBe(true);
    expect(EstimateQuery.of({ stack: [] }).type).toBeUndefined();
  });
});
