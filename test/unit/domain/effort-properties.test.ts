import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../../../src/domain/measurement/activity-events.js';
import { buildTimeline, measureEffort, type EffortInput } from '../../../src/domain/measurement/effort-calculator.js';
import { IdlePolicy } from '../../../src/domain/measurement/idle-policy.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { generateSession, random } from '../../support/session-generator.js';

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

function input(events: readonly ActivityEvent[], first: number, last: number, seed: number): EffortInput {
  const rand = random(seed * 7919);
  return {
    activity: events,
    startedAt: Timestamp.fromMillis(first),
    manual: [],
    parallel: [],
    policy: IdlePolicy.ofMinutes([10, 30, 60][seed % 3] ?? 30),
    now: Timestamp.fromMillis(last + Math.floor(rand() * 3 * 3_600_000)),
  };
}

function summary(events: readonly ActivityEvent[], base: EffortInput) {
  const report = measureEffort({ ...base, activity: events });
  return {
    agents: report.agentTime.millis,
    user: report.userTime.millis,
    uncertainty: report.uncertainty.millis,
    work: report.agentWork.millis,
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rand = random(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

describe('effort properties on generated sessions', () => {
  it.each(SEEDS)('seed %i: one session never yields more fact than the clock', (seed) => {
    const { events, first, last } = generateSession(seed);
    const base = input(events, first, last, seed);
    const report = measureEffort(base);
    expect(report.fact.millis).toBeLessThanOrEqual(report.calendar.millis);
  });

  it.each(SEEDS)('seed %i: agent and user time of one session do not overlap', (seed) => {
    const { events, first, last } = generateSession(seed);
    const timeline = buildTimeline(input(events, first, last, seed));
    const agent = timeline.agents.get('s1/')?.intervals;
    const user = timeline.userBySession.get('s1');
    if (agent && user) {
      expect(agent.union(user).total.millis).toBe(agent.total.millis + user.total.millis);
    }
  });

  it.each(SEEDS)('seed %i: the order of journal lines does not matter', (seed) => {
    const { events, first, last } = generateSession(seed);
    const base = input(events, first, last, seed);
    expect(summary(shuffled(events, seed), base)).toEqual(summary(events, base));
  });

  it.each(SEEDS)('seed %i: a repeated delivery of every event does not matter', (seed) => {
    const { events, first, last } = generateSession(seed);
    const base = input(events, first, last, seed);
    const rand = random(seed * 31);
    const twice = events.flatMap((event) => [
      event,
      { ...event, id: `${event.id}-copy`, ts: new Date(Date.parse(event.ts) + Math.floor(rand() * 1_500)).toISOString() },
    ]);
    expect(summary(shuffled(twice, seed), base)).toEqual(summary(events, base));
  });

  it('several sessions of one user count the user once', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const a = generateSession(seed, 's1');
      const b = generateSession(seed + 1000, 's2');
      const base = input([...a.events, ...b.events], Math.min(a.first, b.first), Math.max(a.last, b.last), seed);
      const both = measureEffort(base);
      const sum =
        measureEffort({ ...base, activity: a.events }).userTime.millis + measureEffort({ ...base, activity: b.events }).userTime.millis;
      expect(both.userTime.millis).toBeLessThanOrEqual(sum);
      expect(both.userTime.millis).toBeLessThanOrEqual(both.calendar.millis);
    }
  });
});
