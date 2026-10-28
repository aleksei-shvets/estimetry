import { describe, expect, it } from 'vitest';
import { InvalidActivityEvent, parseActivityEvent } from '../../../src/domain/measurement/activity-events.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { Extra } from '../../../src/domain/measurement/extra.js';
import { IdlePolicy } from '../../../src/domain/measurement/idle-policy.js';
import { Interval } from '../../../src/domain/measurement/interval.js';
import { IntervalSet } from '../../../src/domain/measurement/interval-set.js';
import { ManualTime } from '../../../src/domain/measurement/manual-time.js';
import { ParallelModeChange } from '../../../src/domain/measurement/parallel-mode.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { at } from '../../support/activity.js';

const span = (from: string, to: string) => Interval.of(at(from), at(to));
const minutes = (set: IntervalSet) => set.total.minutes;

describe('Duration', () => {
  it.each([
    ['40m', 40],
    ['1h30m', 90],
    ['1.5h', 90],
    ['2h', 120],
    ['0.5m', 0.5],
    [' 24h ', 1440],
  ])('parses %s', (text, expected) => {
    expect(Duration.parse(text).minutes).toBe(expected);
  });

  it.each(['90', '', 'h', '1h30', '30m1h', '-5m', '0m', '24h1m', '1d'])('rejects %j', (text) => {
    expect(() => Duration.parse(text)).toThrow(InvalidValue);
  });

  it('explains the expected format', () => {
    expect(() => Duration.parse('90')).toThrow(/expected e\.g\. 40m, 1h30m or 1\.5h/);
  });

  it('adds, subtracts without going negative and measures between timestamps', () => {
    expect(Duration.ofMinutes(10).plus(Duration.ofMinutes(5)).minutes).toBe(15);
    expect(Duration.ofMinutes(5).minus(Duration.ofMinutes(10)).millis).toBe(0);
    expect(Duration.between(at('10:00'), at('10:25')).minutes).toBe(25);
    expect(Duration.between(at('10:25'), at('10:00')).millis).toBe(0);
  });
});

describe('Interval and IntervalSet', () => {
  it('rejects an interval that ends before it starts', () => {
    expect(() => span('10:10', '10:00')).toThrow(InvalidValue);
  });

  it('merges overlapping, touching and nested intervals', () => {
    const set = IntervalSet.of([span('10:00', '10:30'), span('10:20', '10:40'), span('10:40', '10:50'), span('10:05', '10:10')]);
    expect(set.intervals).toHaveLength(1);
    expect(minutes(set)).toBe(50);
  });

  it('keeps disjoint intervals apart and sums them', () => {
    const set = IntervalSet.of([span('11:00', '11:10'), span('10:00', '10:30')]);
    expect(set.intervals.map((i) => i.start.toISOString())).toEqual([at('10:00').toISOString(), at('11:00').toISOString()]);
    expect(minutes(set)).toBe(40);
  });

  it('subtracts, clips and detects overlap', () => {
    const set = IntervalSet.of([span('10:00', '11:00')]);
    expect(minutes(set.minus(IntervalSet.of([span('10:10', '10:20'), span('10:50', '11:30')])))).toBe(40);
    expect(minutes(set.from(at('10:45')))).toBe(15);
    expect(set.overlaps(span('10:59', '11:30'))).toBe(true);
    expect(set.overlaps(span('11:00', '11:30'))).toBe(false);
    expect(minutes(set.union(IntervalSet.of([span('10:30', '11:15')])))).toBe(75);
  });
});

describe('IdlePolicy', () => {
  it('defaults to 30 minutes and accepts 1–240', () => {
    expect(IdlePolicy.DEFAULT.threshold.minutes).toBe(30);
    expect(IdlePolicy.ofMinutes(1).threshold.minutes).toBe(1);
    expect(IdlePolicy.ofMinutes(240).threshold.minutes).toBe(240);
  });

  it.each([0, 241, 2.5])('rejects %s', (value) => {
    expect(() => IdlePolicy.ofMinutes(value)).toThrow(InvalidValue);
  });
});

describe('activity events', () => {
  const valid = {
    schemaVersion: 1,
    id: 'a-1',
    ts: '2026-10-27T10:00:00.000Z',
    type: 'turn.started',
    author: 'dev@example.com',
    task: 'T-1',
    project: 'api',
    data: { source: 'claude-code', session: 's1', origin: 'user' },
  };
  const withData = (data: Record<string, unknown>, type = valid.type) => ({ ...valid, type, data: { ...valid.data, ...data } });

  it('accepts every type of the contract with its optional fields', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['session.started', { resumed: true }],
      ['session.ended', {}],
      ['turn.started', { origin: 'automated', agent: 'a1' }],
      ['turn.ended', { outcome: 'interrupted' }],
      ['turn.awaiting-input', { reason: 'permission' }],
      ['tool.started', { tool: 'Bash', toolUseId: 't1' }],
      ['tool.used', { tool: 'Bash', toolUseId: 't1', durationMs: 1200, failed: true }],
      ['agent.started', { agent: 'a1', parentAgent: 'a0', agentType: 'explore', background: true }],
      ['agent.stopped', { agent: 'a1' }],
    ];
    for (const [type, data] of cases) {
      expect(parseActivityEvent(withData(data, type)).type).toBe(type);
    }
  });

  it.each([
    [{ ...valid, type: 'turn.begun' }, 'type'],
    [withData({ origin: 'robot' }), 'data.origin'],
    [{ ...valid, data: { source: 'x', origin: 'user' } }, 'data.session'],
    [{ ...valid, ts: 'yesterday' }, 'ts'],
    [withData({ durationMs: -1 }, 'tool.used'), 'data.durationMs'],
    [withData({ durationMs: 1.5 }, 'tool.used'), 'data.durationMs'],
    [withData({ failed: 'yes' }, 'tool.used'), 'data.failed'],
    [withData({}, 'agent.started'), 'data.agent'],
    [withData({ reason: 'lunch' }, 'turn.awaiting-input'), 'data.reason'],
    [withData({ agent: '' }), 'data.agent'],
  ])('rejects a contract violation and names the field (%#)', (record, path) => {
    try {
      parseActivityEvent(record);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidActivityEvent);
      expect((error as InvalidActivityEvent).path).toBe(path);
      expect((error as Error).message).toContain(path);
    }
  });

  it('tolerates fields it does not know', () => {
    expect(() => parseActivityEvent(withData({ futureField: 1 }))).not.toThrow();
  });
});

describe('records made during work', () => {
  it('manual time needs a description and keeps an optional end', () => {
    const manual = ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(40), description: ' testing ' });
    expect(manual.toData()).toEqual({ kind: 'user', durationMs: 2_400_000, description: 'testing' });
    const backdated = ManualTime.of({ kind: 'agent', duration: Duration.ofHours(3), at: at('12:00'), description: 'x' });
    expect(ManualTime.fromData(backdated.toData()).at?.toISOString()).toBe(at('12:00').toISOString());
    expect(() => ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(1), description: ' ' })).toThrow(InvalidValue);
  });

  it('extra work accepts the four categories only and is absorbed', () => {
    const extra = Extra.of({ category: 'environment', description: 'Node 21', time: Duration.ofMinutes(30), lines: 12 });
    expect(extra.toData()).toEqual({
      category: 'environment',
      accounting: 'absorbed',
      description: 'Node 21',
      timeMs: 1_800_000,
      lines: 12,
    });
    expect(() => Extra.of({ category: 'oops', description: 'x' })).toThrow(
      /expected one of: new-requirement, missed-analysis, rework, environment/,
    );
    expect(() => Extra.of({ category: 'rework', description: 'x', lines: -1 })).toThrow(InvalidValue);
  });

  it('parallel mode change needs at least one agent and drops duplicate parts', () => {
    expect(ParallelModeChange.of({ reason: ' deadline ', agents: 3, parts: ['a', 'a', ' b '] }).toData()).toEqual({
      reason: 'deadline',
      agents: 3,
      parts: ['a', 'b'],
    });
    expect(() => ParallelModeChange.of({ agents: 0 })).toThrow(InvalidValue);
  });
});
