import { describe, expect, it } from 'vitest';
import { buildCard } from '../../../src/domain/card/build-card.js';
import type { Card } from '../../../src/domain/card/card.js';
import { calibrate } from '../../../src/domain/calibration/calibration.js';
import { median } from '../../../src/domain/calibration/statistics.js';
import { classify } from '../../../src/domain/code/code-classes.js';
import { codeLines, countedCommits } from '../../../src/domain/code/code-volume.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import type { EffortReport } from '../../../src/domain/measurement/effort-report.js';
import { Extra } from '../../../src/domain/measurement/extra.js';
import { Interval } from '../../../src/domain/measurement/interval.js';
import { IntervalSet } from '../../../src/domain/measurement/interval-set.js';
import { ManualTime } from '../../../src/domain/measurement/manual-time.js';
import { ParallelModeChange } from '../../../src/domain/measurement/parallel-mode.js';
import { largestRemainder, partFacts, type PlanPoint } from '../../../src/domain/progress/part-facts.js';
import type { CommitRecorded, ProgressRecord } from '../../../src/domain/progress/progress-records.js';
import { parseProgressRecord } from '../../../src/domain/progress/progress-record-parser.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import type { EventMeta } from '../../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { InvalidTransition, TaskClosed, TaskNotClosed, UnknownEstimatePart } from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
let seq = 0;
const meta = (time = '10:00'): EventMeta => ({ id: `e-${++seq}`, at: at(time), author: Author.of('dev@example.com') });
const api = ProjectId.parse('api');

function estimate(parts: { id: string; group?: string; likely: number; kind?: 'manual-testing' | 'implementation' | 'review' }[], coefficient?: number): Estimate {
  return Estimate.of({
    parts: parts.map((p) =>
      EstimatePart.of({
        id: p.id,
        name: p.id,
        ...(p.group === undefined ? {} : { group: p.group }),
        ...(p.kind === undefined ? {} : { kind: p.kind }),
        hours: ThreePointEstimate.of({ optimistic: p.likely, likely: p.likely, pessimistic: p.likely }),
      }),
    ),
    ...(coefficient === undefined ? {} : { calibrated: true, coefficient }),
  });
}

function started(est?: Estimate): Task {
  const task = Task.create({ id: TaskId.fromNumber(1), title: 'Webhook', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
  if (est) {
    task.saveEstimate(est, undefined, meta('08:30'));
  }
  task.start(api, meta('09:00'));
  return task;
}

describe('closing a task', () => {
  it('closes from in progress, ends parallel mode at the closing moment and refuses records afterwards', () => {
    const task = started(estimate([{ id: 'a', likely: 2 }]));
    task.enableParallelMode(ParallelModeChange.of({ agents: 2 }), meta('10:00'));
    task.close({ at: at('17:00'), outcome: 'completed' }, meta('18:00'));
    expect(task.status).toBe('closed');
    expect(task.parallelMode.at(-1)?.disabledAt).toEqual(at('17:00'));
    expect(task.closedAt?.toISOString()).toBe(at('17:00').toISOString());
    expect(() => task.recordExtra(Extra.of({ category: 'rework', description: 'x' }), meta('18:10'))).toThrow(TaskClosed);
    expect(() => task.attach(ProjectId.parse('web'), meta('18:10'))).toThrow(TaskClosed);
    expect(() => task.start(api, meta('18:10'))).toThrow(TaskClosed);
    const restored = Task.fromEvents([...replay(task)]);
    expect(restored.toSnapshot()).toEqual(Task.rehydrate(task.toSnapshot()).toSnapshot());
  });

  it('refuses a closing moment before the start, before the last record or in the future', () => {
    const task = started();
    task.enableParallelMode(ParallelModeChange.of({}), meta('11:00'));
    expect(() => task.close({ at: at('08:59'), outcome: 'completed' }, meta('12:00'))).toThrow(/before the start/);
    expect(() => task.close({ at: at('10:30'), outcome: 'completed' }, meta('12:00'))).toThrow(/before the last record/);
    expect(() => task.close({ at: at('12:30'), outcome: 'completed' }, meta('12:00'))).toThrow(/future/);
  });

  it('reopens a closed task and marks nothing else', () => {
    const task = started();
    expect(() => task.reopen(meta('10:00'))).toThrow(InvalidTransition);
    task.close({ at: at('10:00'), outcome: 'completed' }, meta('10:00'));
    task.reopen(meta('11:00'));
    expect(task.status).toBe('in-progress');
    expect(task.closures).toEqual([{ at: at('10:00'), outcome: 'completed', recordedAt: at('10:00'), reopenedAt: at('11:00') }]);
  });

  it('renegotiates in one save and does not repeat the extra work on a retry', () => {
    const task = started();
    const next = { next: () => meta('12:00') };
    task.renegotiate({ at: at('12:00'), spawned: TaskId.fromNumber(2), category: 'new-requirement', description: 'v2' }, next);
    expect(task.pullEvents().map((e) => e.type).slice(-2)).toEqual(['task.extra-recorded', 'task.closed']);
    expect(task.extras[0]?.accounting).toBe('renegotiated');
    expect(task.closure).toMatchObject({ outcome: 'renegotiated', spawned: TaskId.fromNumber(2) });

    // Backdated: the extra work is recorded later than the closing moment, and that is fine.
    const late = started();
    late.renegotiate({ at: at('11:00'), spawned: TaskId.fromNumber(3), category: 'new-requirement', description: 'v3' }, { next: () => meta('12:00') });
    expect(late.closure).toMatchObject({ at: at('11:00'), outcome: 'renegotiated' });

    // A retry after the extra was saved but the task stayed open is modelled by an open task with that extra.
    const retry = started();
    retry.recordExtra(Extra.renegotiated({ category: 'new-requirement', description: 'v2', spawned: 'T-2' }), meta('11:00'));
    retry.renegotiate({ at: at('12:00'), spawned: TaskId.fromNumber(2), category: 'new-requirement', description: 'v2' }, next);
    expect(retry.extras).toHaveLength(1);
  });
});

describe('retro', () => {
  it('needs a closed task, a reason and a lesson; a part prefix counts only for a real part', () => {
    const task = started(estimate([{ id: 'manual-testing', likely: 1, kind: 'manual-testing' }]));
    expect(() => task.recordRetro(['x'], 'y', meta('10:00'))).toThrow(TaskNotClosed);
    task.close({ at: at('10:00'), outcome: 'completed' }, meta('10:00'));
    expect(() => task.recordRetro([], 'lesson', meta('10:05'))).toThrow(InvalidValue);
    expect(() => task.recordRetro(['x'], ' ', meta('10:05'))).toThrow(InvalidValue);
    task.recordRetro(['manual-testing: two devices', 'note: API changed twice'], 'plan per platform', meta('10:10'));
    expect(task.retro?.reasons).toEqual([{ text: 'two devices', part: 'manual-testing' }, { text: 'note: API changed twice' }]);
    task.recordRetro(['other'], 'second', meta('10:20'));
    expect(task.retro?.lesson).toBe('second');

    const grouped = started(estimate([{ id: 'greeting-greeting', group: 'greeting', likely: 1 }, { id: 'a', group: 'pair', likely: 1 }, { id: 'b', group: 'pair', likely: 1 }]));
    grouped.close({ at: at('10:00'), outcome: 'completed' }, meta('10:00'));
    grouped.recordRetro(['greeting: trivial', 'pair: shared group'], 'lesson', meta('10:10'));
    expect(grouped.retro?.reasons).toEqual([{ text: 'trivial', part: 'greeting-greeting' }, { text: 'pair: shared group' }]);
    grouped.recordRetro(['x'], 'second', meta('10:20'));
    expect(task.retro?.lesson).toBe('second');
  });

  it('manual time of an unknown part is refused', () => {
    const task = started(estimate([{ id: 'a', likely: 1 }]));
    expect(() =>
      task.recordManualTime(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(5), description: 'x', part: 'nope' }), meta('10:00')),
    ).toThrow(UnknownEstimatePart);
  });
});

const set = (...pairs: [string, string][]) => IntervalSet.of(pairs.map(([a, b]) => Interval.of(at(a), at(b))));
const point = (time: string, project: string, changes: [string, number, number, boolean?][]): PlanPoint => ({
  at: at(time),
  project,
  changes: changes.map(([change, done, total, archived]) => ({ change, done, total, archived: archived ?? false })),
});

describe('fact by parts', () => {
  const base = { startedAt: at('10:00'), closedAt: at('12:00'), completions: [], manual: [] };

  it('gives the work before a box closed to the box, in proportion to the boxes', () => {
    const result = partFacts({
      ...base,
      estimate: estimate([{ id: 'a', group: 'a', likely: 1 }, { id: 'b', group: 'b', likely: 1 }]),
      points: [point('10:00', 'api', [['a', 0, 5], ['b', 0, 5]]), point('10:40', 'api', [['a', 2, 5], ['b', 1, 5]])],
      measured: { agent: set(['10:05', '10:35']), user: IntervalSet.EMPTY },
    });
    expect(result).toEqual({ mode: 'by-checkboxes', parts: [{ minutes: 20 }, { minutes: 10 }], unattributed: 0, beforeRevision: 0 });
  });

  it('keeps time without closings in the pool for the next closing', () => {
    const result = partFacts({
      ...base,
      estimate: estimate([{ id: 'a', group: 'a', likely: 1 }]),
      points: [point('10:00', 'api', [['a', 0, 5]]), point('10:20', 'api', [['a', 0, 5]]), point('10:40', 'api', [['a', 1, 5]])],
      measured: { agent: set(['10:00', '10:15'], ['10:20', '10:35']), user: IntervalSet.EMPTY },
    });
    expect(result.parts).toEqual([{ minutes: 30 }]);
  });

  it('counts the growth of a change against the previous snapshot of the same project', () => {
    const result = partFacts({
      ...base,
      estimate: estimate([{ id: 'a', group: 'a', likely: 1 }, { id: 'b', group: 'b', likely: 1 }]),
      points: [
        point('10:00', 'api', [['a', 2, 5]]),
        point('10:00', 'web', [['b', 1, 4]]),
        point('10:20', 'web', [['b', 1, 4]]),
        point('10:40', 'api', [['a', 3, 5]]),
      ],
      measured: { agent: set(['10:00', '10:40']), user: IntervalSet.EMPTY },
    });
    expect(result.parts).toEqual([{ minutes: 40 }, { minutes: 0 }]);
  });

  it('gives the time after the last checkpoint to the boxes closed by the closing snapshot', () => {
    const result = partFacts({
      ...base,
      estimate: estimate([{ id: 'a', group: 'a', likely: 1 }]),
      points: [point('10:00', 'api', [['a', 0, 3]]), point('12:00', 'api', [['a', 3, 3, true]])],
      measured: { agent: set(['11:00', '11:50']), user: IntervalSet.EMPTY },
    });
    expect(result).toMatchObject({ parts: [{ minutes: 50 }], unattributed: 0 });
  });

  it('measures parts with a group and leaves a part without one at null', () => {
    const result = partFacts({
      ...base,
      estimate: estimate([{ id: 'a', group: 'a', likely: 1 }, { id: 'review', likely: 1 }]),
      points: [point('10:00', 'api', [['a', 0, 1]]), point('10:30', 'api', [['a', 1, 1]])],
      measured: { agent: set(['10:00', '10:30'], ['11:00', '11:10']), user: IntervalSet.EMPTY },
    });
    expect(result).toEqual({ mode: 'by-checkboxes', parts: [{ minutes: 30 }, { minutes: null, reason: 'no-group' }], unattributed: 10, beforeRevision: 0 });
  });

  it('gives manual time of a part to it, and the sum always equals the fact', () => {
    const manual = [
      ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(40), description: 'testing', part: 't' }),
      ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(7), description: 'call' }),
    ];
    const result = partFacts({
      ...base,
      manual,
      estimate: estimate([{ id: 'a', group: 'a', likely: 1 }, { id: 't', group: 'a', likely: 1, kind: 'manual-testing' }]),
      points: [point('10:00', 'api', [['a', 0, 3]]), point('11:00', 'api', [['a', 3, 3]])],
      measured: { agent: set(['10:00', '10:20']), user: set(['10:20', '10:21']) },
    });
    // 21 minutes measured, split 50/50 by likely hours (10.5 each); 40 to `t` directly; 7 untimed to unattributed.
    // The minute left by rounding goes to the first of the equal remainders.
    expect(result.parts.map((p) => p.minutes)).toEqual([11, 50]);
    expect(result.unattributed).toBe(7);
  });

  it('says why there is no fact by parts', () => {
    const measured = { agent: set(['10:00', '10:10']), user: IntervalSet.EMPTY };
    expect(partFacts({ ...base, estimate: undefined, points: [], measured })).toEqual({ mode: 'no-estimate', parts: [], unattributed: 10, beforeRevision: 0 });
    expect(partFacts({ ...base, estimate: estimate([{ id: 'a', group: 'a', likely: 1 }]), points: [], measured }).mode).toBe('no-plan-snapshots');
  });

  it('rounds by the largest remainders to the total', () => {
    expect(largestRemainder([3.4, 3.3, 3.3], 10)).toEqual([4, 3, 3]);
    expect(largestRemainder([0.5, 0.5], 1).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('code volume', () => {
  it('classifies files by the built-in masks in order', () => {
    expect(
      Object.fromEntries(
        [
          'pubspec.lock',
          'lib/model.g.dart',
          'src/build/plan.ts',
          'build/out.js',
          'web/node_modules/x/index.js',
          'test/a.test.ts',
          'src/a.spec.ts',
          'pkg/a_test.go',
          'README.md',
          'openspec/changes/a/tasks.md',
          'requirements.txt',
          '.github/workflows/ci.yml',
          'Dockerfile',
          'db/migrations/001.sql',
          'src/app.ts',
          'web/logo.svg',
          '.estimetry/config.yaml',
          '.claude/settings.local.json',
        ].map((path) => [path, classify(path)]),
      ),
    ).toEqual({
      'pubspec.lock': 'generated',
      'lib/model.g.dart': 'generated',
      'src/build/plan.ts': 'production',
      'build/out.js': 'generated',
      'web/node_modules/x/index.js': 'generated',
      'test/a.test.ts': 'tests',
      'src/a.spec.ts': 'tests',
      'pkg/a_test.go': 'tests',
      'README.md': 'docs',
      'openspec/changes/a/tasks.md': 'docs',
      'requirements.txt': 'config',
      '.github/workflows/ci.yml': 'config',
      Dockerfile: 'config',
      'db/migrations/001.sql': 'config',
      'src/app.ts': 'production',
      'web/logo.svg': 'production',
      '.estimetry/config.yaml': 'generated',
      '.claude/settings.local.json': 'generated',
    });
  });

  const commit = (sha: string, parents: string[], files: [string, number, number][], patchId = sha): CommitRecorded =>
    ({
      type: 'commit.recorded',
      data: {
        source: 'git',
        sha,
        parents,
        patchId,
        authoredAt: '',
        committedAt: '',
        files: files.map(([path, added, deleted]) => ({ path, added, deleted })),
        fileCount: files.length,
        truncated: false,
      },
    }) as unknown as CommitRecorded;

  it('counts reachable commits once, without merges: amend and squash leave only the new commit', () => {
    const c1 = commit('c1', ['p'], [['src/a.ts', 40, 2], ['test/a.test.ts', 30, 0]]);
    const merge = commit('c2', ['c1', 'm'], [['src/b.ts', 100, 0]]);
    const amended = commit('c3', ['p'], [['src/a.ts', 45, 2], ['test/a.test.ts', 30, 0]]);
    const cherry = commit('c4', ['c3'], [['src/a.ts', 45, 2]], 'c3');
    const reachable = (sha: string) => sha !== 'c1';
    const counted = countedCommits([c1, merge, amended, cherry], reachable);
    expect(counted.map((c) => c.data.sha)).toEqual(['c3']);
    const lines = codeLines([{ project: 'api', source: 'commits', files: counted.flatMap((c) => c.data.files), fileCount: 2, truncated: false }]);
    expect(lines).toMatchObject({ production: { added: 45, deleted: 2 }, tests: { added: 30, deleted: 0 } });
    expect(countedCommits([c1, merge], undefined).map((c) => c.data.sha)).toEqual(['c1']);
  });

  it('counts generated and binary files apart from lines', () => {
    expect(
      codeLines([
        {
          project: 'api',
          source: 'commits',
          files: [
            { path: 'pubspec.lock', added: 300, deleted: 0 },
            { path: 'lib/model.g.dart', added: 500, deleted: 0 },
            { path: 'logo.png', added: null, deleted: null },
          ],
          fileCount: 3,
          truncated: false,
        },
      ]),
    ).toMatchObject({ production: { added: 0 }, generatedFiles: 2, binaryFiles: 1 });
  });

  it('validates the new progress records', () => {
    const envelope = { schemaVersion: 1, id: 'r1', ts: '2026-10-27T10:00:00.000Z', author: 'a', task: 'T-1', project: 'api' };
    expect(() =>
      parseProgressRecord({ ...envelope, type: 'code.measured', data: { source: 'estimetry', measuredAt: 'x', projects: [] } }),
    ).toThrow(/measuredAt/);
    expect(() =>
      parseProgressRecord({
        ...envelope,
        type: 'plan.closing',
        data: { source: 'estimetry', projects: [{ project: 'api', changes: [] }], completedGroups: [], unfinishedGroups: ['a'], stack: [] },
      }),
    ).not.toThrow();
  });
});

function replay(task: Task) {
  // The events of a task built in memory: the aggregate keeps them until pulled.
  return task.pullEvents();
}

function report(minutes: number, extra: Partial<EffortReport> = {}): EffortReport {
  const d = Duration.ofMinutes(minutes);
  return {
    agentTime: d,
    userTime: Duration.ZERO,
    fact: d,
    factLow: d,
    factHigh: d,
    uncertainty: Duration.ZERO,
    uncertaintyShare: 0,
    exceedsUncertaintyTarget: false,
    manualTime: Duration.ZERO,
    manualShare: 0,
    agentWork: d,
    sequentialEquivalent: undefined,
    calendar: d,
    parallel: { used: false, maxAgents: undefined },
    backgroundAgents: false,
    measured: { agent: IntervalSet.EMPTY, user: IntervalSet.EMPTY },
    ...extra,
  };
}

function closedCard(input: {
  likely: number;
  minutes: number;
  type?: string;
  author?: string;
  outcome?: 'completed' | 'renegotiated' | 'abandoned';
  coefficient?: number;
  parallelMinutes?: number;
  records?: ProgressRecord[];
  parts?: { id: string; group?: string; likely: number }[];
}): Card {
  const est = estimate(input.parts ?? [{ id: 'all', likely: input.likely }], input.coefficient);
  const task = Task.create(
    { id: TaskId.fromNumber(++seq), title: 'T', type: TaskType.of(input.type ?? 'feature', DEFAULT_TASK_TYPES), project: api },
    { ...meta('08:00'), author: Author.of(input.author ?? 'dev@example.com') },
  );
  task.saveEstimate(est, undefined, meta('08:10'));
  task.start(api, meta('09:00'));
  if (input.outcome === 'renegotiated') {
    task.renegotiate({ at: at('18:00'), spawned: TaskId.fromNumber(999), category: 'new-requirement', description: 'more' }, { next: () => meta('18:00') });
  } else {
    task.close({ at: at('18:00'), outcome: input.outcome ?? 'completed' }, meta('18:00'));
  }
  return buildCard({
    task,
    report: report(
      input.minutes,
      input.parallelMinutes === undefined
        ? {}
        : { parallel: { used: true, maxAgents: 2 }, sequentialEquivalent: Duration.ofMinutes(input.parallelMinutes) },
    ),
    partFacts: { mode: 'no-plan-snapshots', parts: [], unattributed: input.minutes, beforeRevision: 0 },
    records: input.records ?? [],
    hasActivity: true,
  });
}

describe('card', () => {
  it('keeps numbers apart from text and marks a missing retro', () => {
    const card = closedCard({ likely: 9, minutes: 680 });
    expect(card).toMatchObject({ outcome: 'completed', estimate: { likelyHours: 9 }, fact: { totalMinutes: 680 }, retro: 'pending' });
    expect(card.text.title).toBe('T');
    expect(JSON.stringify({ ...card, text: undefined })).not.toContain('"T"');
  });

  it('marks a retro written before a reopening as stale', () => {
    const task = started(estimate([{ id: 'a', likely: 1 }]));
    task.close({ at: at('10:00'), outcome: 'completed' }, meta('10:00'));
    task.recordRetro(['a: slow'], 'lesson', meta('10:10'));
    task.reopen(meta('11:00'));
    task.close({ at: at('12:00'), outcome: 'completed' }, meta('12:00'));
    const card = buildCard({ task, report: report(60), partFacts: { mode: 'no-estimate', parts: [], unattributed: 60, beforeRevision: 0 }, records: [], hasActivity: true });
    expect(card.retro).toEqual({ status: 'stale', reasons: [{ part: 0 }] });
    expect(card.closedMinutes).toBe(60);
  });
});

describe('calibration', () => {
  it('takes the median by type and applies it from five tasks', () => {
    const cards = [1.0, 1.1, 1.2, 1.3, 3.0].map((r) => closedCard({ likely: 10, minutes: r * 600 }));
    const author = calibrate(cards).authors['dev@example.com'];
    expect(author?.ratio.byType['feature']).toMatchObject({ n: 5, median: 1.2, applicable: true });
    expect(calibrate(cards.slice(0, 3)).authors['dev@example.com']?.ratio.overall.applicable).toBe(false);
    expect(median([1.0, 1.2, 1.4, 2.0])).toBe(1.3);
  });

  it('counts a parallel task by its sequential equivalent and a calibrated estimate before the coefficient', () => {
    const parallel = closedCard({ likely: 10, minutes: 360, parallelMinutes: 840 });
    const calibrated = closedCard({ likely: 13, minutes: 780, coefficient: 1.3 });
    const author = calibrate([parallel, calibrated]).authors['dev@example.com'];
    expect(author?.ratio.overall.median).toBe(1.35); // 1.4 and 1.3
  });

  it('compares a renegotiated original with the parts it completed and leaves out abandoned tasks', () => {
    const closing: ProgressRecord = {
      schemaVersion: 1,
      id: 'r',
      ts: '2026-10-27T18:00:00.000Z',
      type: 'plan.closing',
      author: 'dev@example.com',
      task: 'T-1',
      project: 'api',
      data: { source: 'estimetry', projects: [], completedGroups: ['a'], unfinishedGroups: ['b'], stack: [] },
    } as ProgressRecord;
    const renegotiated = closedCard({
      likely: 10,
      minutes: 300,
      outcome: 'renegotiated',
      parts: [{ id: 'a', group: 'a', likely: 4 }, { id: 'b', group: 'b', likely: 6 }],
      records: [closing],
    });
    const abandoned = closedCard({ likely: 10, minutes: 60, outcome: 'abandoned' });
    const author = calibrate([renegotiated, abandoned]).authors['dev@example.com'];
    expect(author?.ratio.overall).toMatchObject({ n: 1, median: 1.25, excluded: { abandoned: 1 } });
  });

  it('keeps authors apart', () => {
    const result = calibrate([closedCard({ likely: 1, minutes: 60, author: 'a@x' }), closedCard({ likely: 1, minutes: 120, author: 'b@x' })]);
    expect(Object.keys(result.authors)).toEqual(['a@x', 'b@x']);
    expect(result.authors['b@x']?.ratio.overall.median).toBe(2);
  });
});
