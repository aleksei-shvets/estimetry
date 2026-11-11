import { describe, expect, it } from 'vitest';
import { Interval } from '../../../src/domain/measurement/interval.js';
import { IntervalSet } from '../../../src/domain/measurement/interval-set.js';
import { parseProgressRecord } from '../../../src/domain/progress/progress-records.js';
import { logBoundaries, sessionLogs, type LogSession, type LogSessionData, type TokenBucket } from '../../../src/domain/progress/session-log.js';
import { taskUsage } from '../../../src/domain/usage/task-usage.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { at } from '../../support/activity.js';

const ms = (time: string) => at(time).toMillis();

let id = 0;
function record(data: Partial<LogSessionData>, ts = '2026-10-27T12:00:00.000Z'): LogSession {
  return {
    schemaVersion: 1,
    id: `r${++id}`,
    ts,
    type: 'log.session',
    author: 'dev@example.com',
    task: 'T-1',
    project: 'api',
    data: { source: 'claude-code-log', session: 's1', importId: `i${id}`, from: 0, part: 1, parts: 1, turns: [], agents: [], cost: [], skipped: 0, ...data },
  };
}

const bucket = (time: string, counts: Partial<TokenBucket> = {}): TokenBucket => ({
  at: ms(time),
  model: 'm',
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  ...counts,
});

const turn = (key: number, start: string, end: string, tokens: TokenBucket[] = []) => ({ key, start: ms(start), end: ms(end), tokens });

describe('merging the records of a session log', () => {
  it('a later import wins from its offset on; earlier turns stay', () => {
    const first = record({ from: 0, turns: [turn(0, '10:00', '10:05'), turn(500, '10:10', '10:12')] });
    const second = record({ from: 500, turns: [turn(500, '10:10', '10:19'), turn(900, '11:00', '11:01')] });
    const merged = sessionLogs([first, second]).get('s1');
    expect(merged?.turns.map((t) => [t.key, t.end])).toEqual([
      [0, ms('10:05')],
      [500, ms('10:19')],
      [900, ms('11:01')],
    ]);
    expect(logBoundaries(sessionLogs([first, second])).get('s1')?.turns).toHaveLength(3);
  });

  it('counts an import only with all its parts', () => {
    const part1 = record({ importId: 'x', part: 1, parts: 2, turns: [turn(0, '10:00', '10:05')] });
    expect(sessionLogs([part1]).size).toBe(0);
    const part2 = record({ importId: 'x', part: 2, parts: 2, turns: [turn(300, '10:10', '10:12')] });
    expect(sessionLogs([part1, part2]).get('s1')?.turns).toHaveLength(2);
  });

  it('takes a subagent and the total of a process from the last record that has them', () => {
    const first = record({ agents: [{ agent: 'a1', spans: [[1, 2]], tokens: [] }], cost: [{ startTime: 1, totalUSD: 4, unknown: false }] });
    const second = record({ from: 0, agents: [{ agent: 'a1', spans: [[1, 9]], tokens: [] }], cost: [{ startTime: 1, totalUSD: 6, unknown: false }, { startTime: 2, totalUSD: 1, unknown: false }] });
    const merged = sessionLogs([first, second]).get('s1');
    expect(merged?.agents.get('a1')?.spans).toEqual([[1, 9]]);
    expect([...(merged?.cost.values() ?? [])].map((total) => total.totalUSD)).toEqual([6, 1]);
  });

  it('ignores records written while the task stayed closed', () => {
    const before = record({ turns: [turn(0, '10:00', '10:05')] }, '2026-10-27T17:00:00.000Z');
    const after = record({ from: 0, turns: [turn(0, '10:00', '10:30')] }, '2026-10-27T19:00:00.000Z');
    const closed = [{ at: Timestamp.parse('2026-10-27T18:00:00.000Z') }];
    expect(sessionLogs([before, after], closed).get('s1')?.turns[0]?.end).toBe(ms('10:05'));
    const reopened = [{ at: Timestamp.parse('2026-10-27T18:00:00.000Z'), reopenedAt: Timestamp.parse('2026-10-27T18:30:00.000Z') }];
    expect(sessionLogs([before, after], reopened).get('s1')?.turns[0]?.end).toBe(ms('10:30'));
  });

  it('validates the record in the journal', () => {
    const valid = record({ turns: [turn(0, '10:00', '10:05', [bucket('10:00', { output: 1 })])] });
    expect(() => parseProgressRecord(valid)).not.toThrow();
    expect(() => parseProgressRecord({ ...valid, data: { ...valid.data, turns: [{ key: -1, tokens: [] }] } })).toThrow(/key/);
    expect(() => parseProgressRecord({ ...valid, data: { ...valid.data, cost: [{ startTime: 1, totalUSD: -1, unknown: false }] } })).toThrow(/totalUSD/);
  });
});

describe('tokens and cost of a task', () => {
  const span = (from: string, to: string) => IntervalSet.of([Interval.of(at(from), at(to))]);
  const log = (tokens: TokenBucket[], cost: [number, number, boolean?][]) =>
    sessionLogs([record({ turns: [{ key: 0, tokens }], cost: cost.map(([startTime, totalUSD, unknown]) => ({ startTime, totalUSD, unknown: unknown ?? false })) })]);

  it('splits the cost of a session between its two tasks by tokens', () => {
    const logs = log([bucket('10:00', { output: 1_000_000 }), bucket('11:00', { output: 2_000_000 })], [[1, 9]]);
    const first = taskUsage({ logs, spans: new Map([['s1', span('09:00', '11:00')]]) });
    const second = taskUsage({ logs, spans: new Map([['s1', span('11:00', '12:00')]]) });
    expect(first).toMatchObject({ costUSD: 3, approximate: true, sessions: 1, withLogs: 1 });
    expect(second).toMatchObject({ costUSD: 6, approximate: true });
    expect(first?.tokens.get('m')?.output).toBe(1_000_000);
  });

  it('weighs the kinds of tokens', () => {
    const logs = log([bucket('10:00', { output: 1_000_000 }), bucket('11:00', { cacheRead: 100_000_000 })], [[1, 10]]);
    expect(taskUsage({ logs, spans: new Map([['s1', span('09:00', '11:00')]]) })?.costUSD).toBeCloseTo(5);
  });

  it('a session of one task gives its cost exactly; tokens before the start make the split approximate', () => {
    const logs = log([bucket('09:00', { output: 1_000_000 }), bucket('11:00', { output: 3_000_000 })], [[1, 8]]);
    expect(taskUsage({ logs, spans: new Map([['s1', span('08:00', '12:00')]]) })).toMatchObject({ costUSD: 8, approximate: false });
    expect(taskUsage({ logs, spans: new Map([['s1', span('10:00', '12:00')]]) })).toMatchObject({ costUSD: 6, approximate: true });
  });

  it('adds the last totals of every process; an unknown cost makes it unknown', () => {
    const tokens = [bucket('10:00', { output: 1 })];
    const spans = new Map([['s1', span('09:00', '12:00')]]);
    const totals = sessionLogs([
      record({ turns: [{ key: 0, tokens }], cost: [{ startTime: 1, totalUSD: 4, unknown: false }] }),
      record({ from: 0, turns: [{ key: 0, tokens }], cost: [{ startTime: 1, totalUSD: 6, unknown: false }, { startTime: 2, totalUSD: 1, unknown: false }] }),
    ]);
    expect(taskUsage({ logs: totals, spans })?.costUSD).toBe(7);
    expect(taskUsage({ logs: log(tokens, [[1, 4, true]]), spans })).toMatchObject({ costUSD: null });
  });

  it('counts sessions without a log, and gives nothing when none has one', () => {
    const logs = log([bucket('10:00', { output: 1 })], [[1, 1]]);
    const spans = new Map([
      ['s1', span('09:00', '12:00')],
      ['s2', span('09:00', '12:00')],
    ]);
    expect(taskUsage({ logs, spans })).toMatchObject({ sessions: 2, withLogs: 1 });
    expect(taskUsage({ logs: new Map(), spans })).toBeUndefined();
  });
});

describe('cards of schema 2', () => {
  it('read by their fields get no bounds and no usage', async () => {
    const { upgradeCardV2 } = await import('../../../src/domain/card/card-v2.js');
    const { syntheticCard } = await import('../../support/cards.js');
    const { usage: _usage, convertedFrom: _from, fact, ...rest } = syntheticCard({ id: 'T-1' });
    const { lowMinutes: _l, highMinutes: _h, counted, ...oldFact } = fact;
    const { lowMinutes: _cl, highMinutes: _ch, ...oldCounted } = counted;
    const card = upgradeCardV2({ ...rest, schemaVersion: 2, fact: { ...oldFact, counted: oldCounted } });
    expect(card).toMatchObject({ schemaVersion: 3, usage: null, convertedFrom: 2, fact: { lowMinutes: null, highMinutes: null, counted: { lowMinutes: null } } });
  });
});

describe('the edges of a span', () => {
  it('a bucket counts by its middle, so the bucket of a start minutes after it is not lost', async () => {
    const { taskUsage: usageOf } = await import('../../../src/domain/usage/task-usage.js');
    const { sessionLogs: merge } = await import('../../../src/domain/progress/session-log.js');
    const at = (hhmm: string) => Date.parse(`2026-10-27T${hhmm}:00.000Z`);
    const logs = merge([record({ turns: [{ key: 0, tokens: [{ at: at('10:00'), model: 'm', input: 0, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }] }] })]);
    const from = (hhmm: string) => new Map([['s1', IntervalSet.of([Interval.of(Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`), Timestamp.parse('2026-10-27T12:00:00.000Z'))])]]);
    expect(usageOf({ logs, spans: from('10:01') })?.tokens.get('m')?.output).toBe(5);
    expect(usageOf({ logs, spans: from('10:04') })?.tokens.get('m')).toBeUndefined();
  });
});
