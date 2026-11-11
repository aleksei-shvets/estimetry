import { describe, expect, it } from 'vitest';
import { buildCard } from '../../../src/domain/card/build-card.js';
import type { Card } from '../../../src/domain/card/card.js';
import { upgradeCardV1, type CardV1 } from '../../../src/domain/card/card-v1.js';
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
import { partFacts, type PlanPoint } from '../../../src/domain/progress/part-facts.js';
import { exclusionsOf, NO_EXCLUSIONS } from '../../../src/domain/progress/plan-exclusions.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import type { EventMeta } from '../../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
let seq = 0;
const meta = (time: string): EventMeta => ({ id: `e-${++seq}`, at: at(time), author: Author.of('dev@example.com') });
const api = ProjectId.parse('api');
const set = (...pairs: [string, string][]) => IntervalSet.of(pairs.map(([a, b]) => Interval.of(at(a), at(b))));

function estimate(likely: number, groups: string[] = ['a']): Estimate {
  return Estimate.of({
    parts: groups.map((group) =>
      EstimatePart.of({ id: group, name: group, group, hours: ThreePointEstimate.of({ optimistic: likely, likely, pessimistic: likely }) }),
    ),
  });
}

function started(first: Estimate = estimate(10)): Task {
  const task = Task.create({ id: TaskId.fromNumber(++seq), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
  task.saveEstimate(first, undefined, meta('08:30'));
  task.start(api, meta('09:00'));
  return task;
}

const revision = (input: Partial<Parameters<typeof EstimateRevision.of>[0]> & { at: Timestamp }) =>
  EstimateRevision.of({ estimate: estimate(12), reason: 'design was wrong', category: 'missed-analysis', spent: 'exclude', ...input });

const manualReport = (minutes: number) =>
  measureEffort({
    activity: [],
    startedAt: at('09:00'),
    manual: [ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(minutes), description: 'x' })],
    parallel: [],
    policy: IdlePolicy.ofMinutes(30),
    now: at('18:00'),
  });

const point = (time: string, changes: [string, number, number, boolean?, string?, number?][], revisionId?: string): PlanPoint => ({
  at: at(time),
  project: 'api',
  changes: changes.map(([change, done, total, archived, archivedOn, changedAt]) => ({
    change,
    done,
    total,
    archived: archived ?? false,
    ...(archivedOn === undefined ? {} : { archivedOn }),
    ...(changedAt === undefined ? {} : { changedAt }),
  })),
  ...(revisionId === undefined ? {} : { revision: revisionId }),
});

function revisedCard(input: { lost?: number; before?: number; code?: boolean } = {}): Card {
  const task = started();
  task.reviseEstimate(revision({ at: at('11:00'), lostFrom: at('10:00'), type: 'research' }), meta('11:00'));
  task.close({ at: at('18:00'), outcome: 'completed' }, meta('18:00'));
  const card = buildCard({
    task,
    report: manualReport(14 * 60),
    counted: manualReport(12 * 60),
    partFacts: { mode: 'by-checkboxes', parts: [{ minutes: 12 * 60 - (input.before ?? 0) }], unattributed: 0, beforeRevision: input.before ?? 0 },
    revisionFacts: [{ countedAtMinutes: 60, lostMinutes: input.lost ?? 120 }],
    records: [],
    hasActivity: true,
  });
  return card;
}

describe('card v2 of a revised task', () => {
  it('keeps the first estimate and its type, and adds the current one, the revision and the counted fact', () => {
    const card = revisedCard();
    expect(card).toMatchObject({
      schemaVersion: 3,
      estimate: { likelyHours: 10, type: 'feature' },
      currentEstimate: { likelyHours: 12, type: 'research' },
      revisions: [{ typeBefore: 'feature', typeAfter: 'research', baseLikelyBeforeHours: 10, baseLikelyAfterHours: 12, lostMinutes: 120, countedAtMinutes: 60, spent: 'exclude' }],
      fact: { totalMinutes: 840, counted: { totalMinutes: 720, minimal: false } },
      parts: [{ factMinutes: null, reason: 'revised' }],
      currentParts: [{ factMinutes: 720 }],
    });
    expect(card.text.revisions).toEqual([{ reason: 'design was wrong' }]);
    expect(JSON.stringify({ ...card, text: undefined })).not.toContain('design was wrong');
  });

  it('puts extra work covered by an exclude revision apart from the extras', () => {
    const task = started();
    task.recordExtra(Extra.of({ category: 'missed-analysis', description: 'rolled back', time: Duration.ofMinutes(90) }), meta('10:30'));
    const id = task.extraRecords[0]?.id as string;
    task.reviseEstimate(revision({ at: at('11:00'), lostFrom: at('10:00'), covers: [id] }), meta('11:00'));
    task.close({ at: at('18:00'), outcome: 'completed' }, meta('18:00'));
    const card = buildCard({ task, report: manualReport(600), partFacts: { mode: 'no-plan-snapshots', parts: [], unattributed: 0, beforeRevision: 600 }, records: [], hasActivity: true });
    expect(card.extras['missed-analysis'].absorbed.count).toBe(0);
    expect(card.coveredByRevision['missed-analysis']).toEqual({ count: 1, timed: 1, minutes: 90 });
    expect(calibrate([card]).authors['dev@example.com']?.extras['feature']?.['missed-analysis']?.absorbed.share).toBe(0);
  });

  it('takes --covers only with exclude, and an extra work only once', () => {
    const task = started();
    task.recordExtra(Extra.of({ category: 'rework', description: 'x', time: Duration.ofMinutes(30) }), meta('09:30'));
    const id = task.extraRecords[0]?.id as string;
    expect(() => task.reviseEstimate(revision({ at: at('10:00'), spent: 'include', covers: [id] }), meta('10:00'))).toThrow(/only with --spent exclude/);
    task.reviseEstimate(revision({ at: at('10:00'), lostFrom: at('09:15'), covers: [id] }), meta('10:00'));
    expect(() => task.reviseEstimate(revision({ at: at('11:00'), lostFrom: at('10:30'), covers: [id] }), meta('11:00'))).toThrow(InvalidValue);
  });
});

describe('fact by parts after a revision', () => {
  const twoGroups = estimate(2, ['x', 'y']);
  const revisionAt = (time: string, id = 'r1') => ({ id, at: at(time), exclusions: NO_EXCLUSIONS });

  it('splits the time after the revision by the new plan and keeps the time before it apart', () => {
    const result = partFacts({
      estimate: twoGroups,
      startedAt: at('09:00'),
      closedAt: at('14:00'),
      points: [point('09:00', [['old', 0, 2]]), point('11:00', [['old', 1, 2], ['x', 0, 3], ['y', 0, 3]], 'r1'), point('14:00', [['x', 3, 3], ['y', 0, 3]])],
      completions: [],
      measured: { agent: set(['09:00', '14:00']), user: IntervalSet.EMPTY },
      manual: [],
      lost: set(['10:00', '11:00']),
      revision: revisionAt('11:00'),
    });
    expect(result).toEqual({ mode: 'by-checkboxes', parts: [{ minutes: 180 }, { minutes: 0 }], unattributed: 0, beforeRevision: 60 });
  });

  it('a revision backdated with --at gives the time from that moment to the new plan', () => {
    const result = partFacts({
      estimate: twoGroups,
      startedAt: at('09:00'),
      closedAt: at('16:00'),
      points: [point('09:00', [['old', 0, 1]]), point('15:00', [['x', 3, 3], ['y', 0, 3]], 'r1'), point('16:00', [['x', 3, 3], ['y', 1, 3]])],
      completions: [],
      measured: { agent: set(['09:00', '16:00']), user: IntervalSet.EMPTY },
      manual: [],
      revision: revisionAt('10:40'),
    });
    expect(result).toEqual({ mode: 'by-checkboxes', parts: [{ minutes: 260 }, { minutes: 60 }], unattributed: 0, beforeRevision: 100 });
  });

  it('a plan snapshot written later by --repair does not change the split', () => {
    const input = {
      estimate: twoGroups,
      startedAt: at('09:00'),
      closedAt: at('18:00'),
      completions: [],
      measured: { agent: set(['09:00', '18:00']), user: IntervalSet.EMPTY },
      manual: [],
      revision: revisionAt('11:00'),
    };
    const points = [point('09:00', [['old', 0, 1]]), point('12:00', [['x', 1, 2], ['y', 0, 2]]), point('18:00', [['x', 2, 2], ['y', 2, 2]])];
    const before = partFacts({ ...input, points });
    const after = partFacts({ ...input, points: [...points, point('17:00', [['x', 1, 2], ['y', 1, 2]], 'r1')] });
    expect(after).toEqual(before);
    expect(before.beforeRevision).toBe(120);
  });

  it('without a snapshot of the plan after the revision only the time before it is known', () => {
    const result = partFacts({
      estimate: twoGroups,
      startedAt: at('09:00'),
      closedAt: at('12:00'),
      points: [point('09:00', [['x', 0, 1]])],
      completions: [],
      measured: { agent: set(['09:00', '12:00']), user: IntervalSet.EMPTY },
      manual: [],
      revision: revisionAt('11:00'),
    });
    expect(result).toMatchObject({ mode: 'no-plan-snapshots', unattributed: 60, beforeRevision: 120 });
  });

  it('a change rolled back and done again under the same name grows again', () => {
    const changedAt = at('10:00').toMillis();
    const exclusions = exclusionsOf([
      { at: at('10:30').toISOString(), spent: 'exclude', excluded: [{ project: 'api', archives: [{ change: 'auth', archivedOn: '2026-10-27', changedAt }] }] },
    ]);
    const result = partFacts({
      estimate: estimate(2, ['auth']),
      startedAt: at('09:00'),
      closedAt: at('13:00'),
      points: [
        point('09:00', [['auth', 0, 2]]),
        point('10:00', [['auth', 2, 2, true, '2026-10-27', changedAt]]),
        point('10:30', [['auth', 2, 2, true, '2026-10-27', changedAt]], 'r1'),
        point('12:00', [['auth', 1, 2]]),
        point('13:00', [['auth', 2, 2, true, '2026-10-27', at('13:00').toMillis()]]),
      ],
      completions: [],
      measured: { agent: set(['09:00', '13:00']), user: IntervalSet.EMPTY },
      manual: [],
      revision: { id: 'r1', at: at('10:30'), exclusions },
    });
    expect(result).toEqual({ mode: 'by-checkboxes', parts: [{ minutes: 150 }], unattributed: 0, beforeRevision: 90 });
  });

  it('manual time without a moment recorded before the revision is before it, after it unattributed', () => {
    const result = partFacts({
      estimate: twoGroups,
      startedAt: at('09:00'),
      closedAt: at('12:00'),
      points: [point('09:00', [['x', 0, 1]]), point('12:00', [['x', 1, 1], ['y', 0, 1]])],
      completions: [],
      measured: { agent: IntervalSet.EMPTY, user: IntervalSet.EMPTY },
      manual: [
        ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(120), description: 'meeting' }),
        ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(15), description: 'call' }),
      ],
      manualRecordedAt: [at('10:00'), at('11:30')],
      revision: revisionAt('11:00'),
    });
    expect(result).toEqual({ mode: 'by-checkboxes', parts: [{ minutes: 0 }, { minutes: 0 }], unattributed: 15, beforeRevision: 120 });
  });

  it('manual time for a part recorded before the revision is about the previous plan', () => {
    const result = partFacts({
      estimate: twoGroups,
      startedAt: at('09:00'),
      closedAt: at('12:00'),
      points: [point('09:00', [['x', 0, 1]]), point('12:00', [['x', 1, 1], ['y', 0, 1]])],
      completions: [],
      measured: { agent: IntervalSet.EMPTY, user: IntervalSet.EMPTY },
      manual: [
        ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(30), description: 'old', part: 'x' }),
        ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(20), description: 'new', part: 'x' }),
      ],
      manualRecordedAt: [at('10:00'), at('11:30')],
      revision: revisionAt('11:00'),
    });
    expect(result).toEqual({ mode: 'by-checkboxes', parts: [{ minutes: 20 }, { minutes: 0 }], unattributed: 0, beforeRevision: 30 });
  });
});

describe('calibration v2', () => {
  it('compares the whole fact with the first estimate and the counted one with the current, by the type of each', () => {
    const calibration = calibrate([revisedCard()]).authors['dev@example.com'];
    expect(calibration?.ratio.byType['feature']).toMatchObject({ n: 1, median: 1.4, revised: 1 });
    expect(calibration?.ratio.byType['research']).toBeUndefined();
    expect(calibration?.revised.byType['research']).toMatchObject({ n: 1, median: 1, countedAtShare: 0.083 });
    expect(calibration?.revisions.byType['feature']?.['missed-analysis']?.exclude).toEqual({ n: 1, growth: 1.2, lostShare: 0.2 });
  });

  it('gives the parts of a revised task only if little was spent before the revision', () => {
    const sole = (card: Card): Card => ({ ...card, currentParts: card.currentParts.map((part) => ({ ...part, soleInGroup: true })) });
    const little = sole(revisedCard({ before: 20 }));
    const much = sole(revisedCard({ before: 300 }));
    expect(calibrate([little, much]).authors['dev@example.com']?.parts).toEqual({ byKind: { implementation: { n: 1, median: 0.972 } }, excluded: 1 });
  });

  it('leaves tasks with an exclude revision out of the code volume, counting them', () => {
    const card = { ...revisedCard(), code: { measuredAt: '', measuredLater: false, projects: [], lines: { production: { added: 10, deleted: 0 }, tests: { added: 0, deleted: 0 }, config: { added: 0, deleted: 0 }, docs: { added: 0, deleted: 0 }, generatedFiles: 0 } } } as unknown as Card;
    const calibration = calibrate([card]).authors['dev@example.com'];
    expect(calibration?.codeVolume.excluded).toBe(1);
    expect(calibration?.linesPerHour).toEqual({ byStack: {}, excluded: 1 });
  });

  it('a revision with include and one with exclude count apart', () => {
    const task = started();
    task.reviseEstimate(revision({ at: at('10:00'), spent: 'include', category: 'rework' }), meta('10:00'));
    task.reviseEstimate(revision({ at: at('11:00'), lostFrom: at('10:30'), estimate: estimate(15) }), meta('11:00'));
    task.close({ at: at('18:00'), outcome: 'completed' }, meta('18:00'));
    expect(task.lostWindows).toHaveLength(1);
    const card = buildCard({
      task,
      report: manualReport(600),
      partFacts: { mode: 'no-plan-snapshots', parts: [], unattributed: 0, beforeRevision: 600 },
      revisionFacts: [{ countedAtMinutes: 60, lostMinutes: 0 }, { countedAtMinutes: 120, lostMinutes: 30 }],
      records: [],
      hasActivity: true,
    });
    const revisions = calibrate([card]).authors['dev@example.com']?.revisions.byType['feature'];
    expect(revisions?.['rework']?.include).toEqual({ n: 1, growth: 1.2, lostShare: null });
    expect(revisions?.['missed-analysis']?.exclude).toEqual({ n: 1, growth: 1.25, lostShare: 0.05 });
  });

  it('a card of schema 1 without its journal: by its fields, a revised one left out of what it cannot tell', () => {
    const v2 = revisedCard();
    const { currentEstimate: _current, revisions: _revisions, currentParts: _parts, beforeRevisionMinutes: _before, coveredByRevision: _covered, ...rest } = v2;
    const v1 = { ...rest, schemaVersion: 1, estimate: { ...v2.estimate, type: undefined }, fact: v2.fact, partsFact: 'revised', text: { ...v2.text } } as unknown as CardV1;
    const card = upgradeCardV1(v1);
    expect(card).toMatchObject({ convertedFrom: 1, estimate: { type: 'research' }, revisions: [], fact: { counted: { totalMinutes: 840 } } });
    const calibration = calibrate([card]).authors['dev@example.com'];
    expect(calibration?.revised.overall.excluded).toEqual({ 'card-v1': 1 });
    expect(calibration?.revisions.excluded).toEqual({ 'card-v1': 1 });
    expect(calibration?.parts.excluded).toBe(1);
    expect(calibration?.codeVolume.excluded).toBe(1);
  });

  it('a task estimated only after its start is left out of the revised slice', () => {
    const task = Task.create({ id: TaskId.fromNumber(++seq), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
    task.start(api, meta('09:00'));
    task.reviseEstimate(EstimateRevision.of({ estimate: estimate(5), reason: 'first', at: at('10:00') }), meta('10:00'));
    task.reviseEstimate(revision({ at: at('11:00'), lostFrom: at('10:30') }), meta('11:00'));
    task.close({ at: at('18:00'), outcome: 'completed' }, meta('18:00'));
    const card = buildCard({ task, report: manualReport(300), partFacts: { mode: 'no-plan-snapshots', parts: [], unattributed: 0, beforeRevision: 300 }, records: [], hasActivity: true });
    expect(card).toMatchObject({ estimatedAfterStart: true, estimate: { likelyHours: 5 }, currentEstimate: { likelyHours: 12 } });
    expect(calibrate([card]).authors['dev@example.com']?.revised.overall.excluded).toEqual({ 'estimated-after-start': 1 });
  });
});
