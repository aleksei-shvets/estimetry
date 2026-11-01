import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../../../src/domain/measurement/activity-events.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { measureEffort } from '../../../src/domain/measurement/effort-calculator.js';
import { IdlePolicy } from '../../../src/domain/measurement/idle-policy.js';
import { ManualTime } from '../../../src/domain/measurement/manual-time.js';
import type { ParallelPeriod } from '../../../src/domain/measurement/parallel-mode.js';
import { activity, at, ev } from '../../support/activity.js';

interface Options {
  readonly start?: string;
  readonly now?: string;
  readonly idle?: number;
  readonly manual?: readonly ManualTime[];
  readonly parallel?: readonly ParallelPeriod[];
}

/** Report with durations in minutes; the task starts at 08:00 and "now" is late in the evening by default. */
function measure(events: readonly ActivityEvent[], options: Options = {}) {
  const report = measureEffort({
    activity: events,
    startedAt: at(options.start ?? '08:00'),
    manual: options.manual ?? [],
    parallel: options.parallel ?? [],
    policy: IdlePolicy.ofMinutes(options.idle ?? 30),
    now: at(options.now ?? '23:00'),
  });
  const min = (d: Duration) => d.minutes;
  return {
    agents: min(report.agentTime),
    user: min(report.userTime),
    fact: min(report.fact),
    uncertainty: min(report.uncertainty),
    work: min(report.agentWork),
    report,
  };
}

const manual = (minutes: number, time?: string, kind: 'user' | 'agent' = 'user') =>
  ManualTime.of({ kind, duration: Duration.ofMinutes(minutes), ...(time ? { at: at(time) } : {}), description: 'x' });

describe('idle threshold', () => {
  it('uses the configured threshold', () => {
    const events = [ev.prompt('10:00'), ev.stop('10:05'), ev.prompt('10:50'), ev.stop('10:55')];
    expect(measure(events, { idle: 60 }).user).toBe(45);
    expect(measure(events, { idle: 30 }).user).toBe(0);
  });
});

describe('preparing events', () => {
  it('orders events by time, not by journal line', () => {
    const ordered = [ev.prompt('10:00'), ev.toolStarted('10:05', { toolUseId: 't1' }), ev.toolUsed('10:20', { toolUseId: 't1' }), ev.stop('10:30')];
    const shuffled = [ordered[2]!, ordered[3]!, ordered[0]!, ordered[1]!];
    expect(measure(shuffled).agents).toBe(measure(ordered).agents);
    expect(measure(shuffled).agents).toBe(30);
  });

  it('ignores repeated deliveries of the same hook', () => {
    const once = [
      ev.prompt('10:00'),
      ev.toolStarted('10:05', { toolUseId: 't1' }),
      ev.toolUsed('10:40', { toolUseId: 't1' }),
      ev.stop('10:45'),
      ev.prompt('11:00'),
      ev.stop('11:10'),
    ];
    const twice: ActivityEvent[] = once.flatMap((event) => [
      event,
      { ...event, id: `${event.id}-copy`, ts: new Date(Date.parse(event.ts) + 400).toISOString() },
    ]);
    expect(measure(twice)).toMatchObject({ agents: 55, user: 15 });
    expect(measure(twice).fact).toBe(measure(once).fact);
  });

  it('keeps a quick turn right after another one, although its events are of the same types', () => {
    const result = measure([ev.prompt('10:00'), ev.stop('10:20:00'), ev.prompt('10:20:01'), ev.stop('10:20:02'), ev.prompt('10:30'), ev.stop('10:40')]);
    expect(result.agents).toBeCloseTo(30, 1);
    expect(result.user).toBeCloseTo(10, 1);
    expect(result.uncertainty).toBe(5); // the 20 minutes of the first turn without a tool, as without the quick turn
  });

  it('keeps a second permission prompt that comes within two seconds of the first', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.toolStarted('10:01:00', { toolUseId: 't1' }),
      ev.waiting('10:01:00', { reason: 'permission' }),
      ev.toolUsed('10:01:01', { toolUseId: 't1', durationMs: 0 }),
      ev.toolStarted('10:01:01', { toolUseId: 't2' }),
      ev.waiting('10:01:02', { reason: 'permission' }),
      ev.toolUsed('10:20', { toolUseId: 't2', durationMs: 0 }),
      ev.stop('10:30'),
    ]);
    expect(result.user).toBeCloseTo(19, 0);
    expect(result.agents).toBeCloseTo(11, 0);
  });

  it('ignores a notification that arrives after the turn ended', () => {
    const result = measure([ev.prompt('10:00'), ev.stop('10:20'), ev.waiting('10:21'), ev.prompt('10:40'), ev.stop('10:45')]);
    expect(result.user).toBe(20);
    expect(result.agents).toBe(25);
  });
});

describe('clipping at the start of the task', () => {
  it('keeps a turn in which `emt start` ran although its start is not in the journal', () => {
    const result = measure([ev.toolUsed('10:02'), ev.stop('10:30')], { start: '10:02' });
    expect(result.agents).toBe(28);
  });

  it('restores a missing turn start no further back than the threshold', () => {
    const result = measure([ev.toolUsed('12:00'), ev.stop('12:10')], { start: '08:00' });
    expect(result.agents).toBe(40);
    expect(result.uncertainty).toBe(30); // the restored half hour is a guess
  });

  it('counts only the part of a turn after the start', () => {
    expect(measure([ev.prompt('10:00'), ev.toolStarted('10:01'), ev.toolUsed('10:29'), ev.stop('10:30')], { start: '10:10' }).agents).toBe(20);
  });
});

describe('agent intervals', () => {
  it('a turn lasts from its start to its end', () => {
    expect(measure([ev.prompt('10:00'), ev.toolStarted('10:01'), ev.toolUsed('10:24'), ev.stop('10:25')]).agents).toBe(25);
  });

  it('an abandoned turn ends at its last event', () => {
    const result = measure([ev.prompt('10:00'), ev.toolStarted('10:05'), ev.toolUsed('10:40')], { now: '15:00' });
    expect(result.agents).toBe(40);
    expect(result.uncertainty).toBe(30); // the tail after the last event, up to the threshold
  });

  it('a turn in progress lasts until now', () => {
    expect(measure([ev.prompt('10:00'), ev.toolStarted('10:05'), ev.toolUsed('10:40')], { now: '10:50' }).agents).toBe(50);
  });

  it('a new prompt closes an interrupted turn at its last event', () => {
    const result = measure([ev.prompt('10:00'), ev.toolUsed('10:10'), ev.prompt('10:25'), ev.stop('10:35')]);
    expect(result).toMatchObject({ agents: 20, user: 15 });
  });

  it('waiting for permission while the user is away is a pause, although the tool is formally running', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.toolStarted('10:10', { toolUseId: 't1' }),
      ev.waiting('10:10', { reason: 'permission' }),
      ev.toolUsed('11:40', { toolUseId: 't1', durationMs: 10 * 60_000 }),
      ev.stop('11:40'),
    ]);
    expect(result.agents).toBe(20);
    expect(result.user).toBe(0);
  });

  it('a short permission wait is user time and the rest of the tool is agent time', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.toolStarted('10:10', { toolUseId: 't1' }),
      ev.waiting('10:10', { reason: 'permission' }),
      ev.toolUsed('10:40', { toolUseId: 't1', durationMs: 25 * 60_000 }),
      ev.stop('10:40'),
    ]);
    expect(result).toMatchObject({ agents: 35, user: 5 });
  });

  it('a question left open over lunch is a pause', () => {
    const result = measure([ev.prompt('11:50'), ev.waiting('12:00', { reason: 'question' }), ev.toolUsed('13:10'), ev.stop('13:15')]);
    expect(result.agents).toBe(15);
    expect(result.user).toBe(0);
  });

  it('a long tool is agent time', () => {
    expect(measure([ev.prompt('10:00'), ev.toolStarted('10:00'), ev.toolUsed('10:50'), ev.stop('10:50')]).agents).toBe(50);
  });

  it('a hung turn without a running tool is a pause after the threshold', () => {
    expect(measure([ev.prompt('10:00'), ev.toolUsed('10:05'), ev.stop('11:30')]).agents).toBe(5);
  });

  it('a tool that never reported back ends with its turn', () => {
    const result = measure([ev.prompt('10:00'), ev.toolStarted('10:05'), ev.stop('10:20'), ev.prompt('13:00'), ev.stop('13:10')]);
    expect(result.agents).toBe(30);
    expect(result.user).toBe(0);
  });

  it('a session end closes an open turn', () => {
    expect(measure([ev.prompt('10:00'), ev.toolUsed('10:10'), ev.sessionEnded('10:20')]).agents).toBe(20);
  });
});

describe('user intervals', () => {
  it('counts review between turns', () => {
    expect(measure([ev.prompt('10:00'), ev.stop('10:25'), ev.prompt('10:40'), ev.stop('10:41')]).user).toBe(15);
  });

  it('a silence longer than the threshold is a pause', () => {
    expect(measure([ev.prompt('10:00'), ev.stop('10:25'), ev.prompt('11:30'), ev.stop('11:31')]).user).toBe(0);
  });

  it('an automated turn is agent time only; the silences around it are the user’s', () => {
    const result = measure([ev.prompt('09:50'), ev.stop('10:00'), ev.automated('10:10'), ev.stop('10:20'), ev.prompt('10:30'), ev.stop('10:30')]);
    expect(result.agents).toBe(20);
    expect(result.user).toBe(20);
    expect(result.fact).toBe(40); // 09:50–10:30 on the clock
  });

  it('after an automated turn only the silence the user was near for counts', () => {
    const result = measure([ev.prompt('09:50'), ev.stop('10:00'), ev.automated('10:40'), ev.stop('10:50'), ev.prompt('11:05'), ev.stop('11:05')]);
    expect(result.agents).toBe(20);
    expect(result.user).toBe(15);
  });

  it('ends the user span at the session end', () => {
    expect(measure([ev.prompt('10:00'), ev.stop('10:25'), ev.sessionEnded('10:35')]).user).toBe(10);
  });

  it('a session start inside a turn (compaction) does not open a user span', () => {
    const result = measure([ev.prompt('10:00'), ev.sessionStarted('10:20'), ev.toolUsed('10:25'), ev.stop('10:40')]);
    expect(result).toMatchObject({ agents: 40, user: 0 });
  });

  it('a user span in progress lasts until now', () => {
    expect(measure([ev.prompt('10:00'), ev.stop('10:10')], { now: '10:20' }).user).toBe(10);
  });
});

describe('fact', () => {
  it('matches the example of design §4', () => {
    const events = [
      ev.sessionStarted('09:40'),
      ev.prompt('10:00'),
      ev.toolStarted('10:00', { toolUseId: 'a' }),
      ev.toolUsed('11:00', { toolUseId: 'a' }),
      ev.stop('11:00'),
      ev.sessionEnded('11:20'),
      ...['s2', 's3'].flatMap((session) => [
        ev.sessionStarted('10:00', { session }),
        ev.prompt('10:00', { session }),
        ev.toolStarted('10:00', { session, toolUseId: 'a' }),
        ev.toolUsed('11:00', { session, toolUseId: 'a' }),
        ev.stop('11:00', { session }),
        ev.sessionEnded('11:00', { session }),
      ]),
    ];
    const result = measure(events);
    expect(result).toMatchObject({ agents: 60, user: 40, fact: 100, work: 180 });
    expect(result.uncertainty).toBe(10); // two counted 20-minute silences, 5 minutes past half the threshold each
  });

  it('a user reviewing three sessions at once is counted once', () => {
    const events = ['s1', 's2', 's3'].flatMap((session) => [
      ev.prompt('10:59', { session }),
      ev.stop('11:00', { session }),
      ev.prompt('11:30', { session }),
      ev.stop('11:31', { session }),
    ]);
    expect(measure(events).user).toBe(30);
  });

  it('manual time with an end merges with measured time', () => {
    const events = [ev.prompt('09:50'), ev.stop('10:00'), ev.prompt('10:25'), ev.stop('10:30')];
    expect(measure(events).user).toBe(25);
    expect(measure(events, { manual: [manual(25, '10:25')] }).user).toBe(25);
  });

  it('manual time without an end is added on top', () => {
    const events = [ev.prompt('09:50'), ev.stop('10:00'), ev.prompt('10:25'), ev.stop('10:30')];
    const result = measure(events, { manual: [manual(40)] });
    expect(result.user).toBe(65);
    expect(result.report.manualTime.minutes).toBe(40);
  });

  it('manual agent time adds to agent time and work', () => {
    const result = measure([], { manual: [manual(180, '12:00', 'agent'), manual(60, undefined, 'agent')] });
    expect(result).toMatchObject({ agents: 240, work: 240, fact: 240 });
    expect(result.report.manualShare).toBe(1);
  });

  it('a foreground subagent inside a turn does not add agent time', () => {
    const events = [
      ev.prompt('10:00'),
      ev.toolStarted('10:10', { toolUseId: 'task' }),
      ev.agentStarted('10:10', 'a1'),
      ev.toolUsed('10:30', { agent: 'a1' }),
      ev.agentStopped('10:50', 'a1'),
      ev.toolUsed('10:50', { toolUseId: 'task' }),
      ev.stop('11:00'),
    ];
    expect(measure(events)).toMatchObject({ agents: 60, work: 60 });
  });
});

describe('waits of subagents', () => {
  it('a foreground subagent waiting for the user blocks its parent, so the wait is counted once', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.toolStarted('10:00', { toolUseId: 'task' }),
      ev.agentStarted('10:00', 'a1'),
      ev.waiting('10:10', { agent: 'a1', reason: 'permission' }),
      ev.toolUsed('10:15', { agent: 'a1', durationMs: 0 }),
      ev.agentStopped('10:30', 'a1'),
      ev.toolUsed('10:30', { toolUseId: 'task' }),
      ev.stop('10:30'),
    ]);
    expect(result).toMatchObject({ agents: 25, user: 5, fact: 30, work: 25 });
  });

  it('the wait of a background subagent is not the user’s while the main agent of the session works', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.agentStarted('10:00', 'a1', { background: true }),
      ev.waiting('10:10', { agent: 'a1', reason: 'permission' }),
      ev.toolUsed('10:15', { agent: 'a1', durationMs: 0 }),
      ev.stop('10:30'),
      ev.agentStopped('10:40', 'a1'),
      ev.sessionEnded('10:45'),
    ]);
    expect(result).toMatchObject({ agents: 40, user: 15, fact: 55 });
  });
});

describe('uncertainty', () => {
  it('adds the part of a counted silence past half the threshold and a dropped silence up to twice the threshold', () => {
    const events = [ev.prompt('10:00'), ev.stop('10:01'), ev.prompt('10:21'), ev.stop('10:22'), ev.prompt('11:02'), ev.stop('11:03')];
    const result = measure(events);
    expect(result.user).toBe(20);
    expect(result.uncertainty).toBe(45);
    expect(result.report.exceedsUncertaintyTarget).toBe(true);
  });

  it('a 31-minute review is a pause, but a visible one', () => {
    const result = measure([ev.prompt('10:00'), ev.stop('10:01'), ev.prompt('10:32'), ev.stop('10:33')]);
    expect(result.user).toBe(0);
    expect(result.uncertainty).toBe(31);
  });

  it('a tool running longer than twice the threshold counts but is doubtful as a whole', () => {
    const result = measure([ev.prompt('10:00'), ev.toolStarted('10:00'), ev.toolUsed('13:00'), ev.stop('13:00')]);
    expect(result.agents).toBe(180);
    expect(result.uncertainty).toBe(180);
  });

  it('a long wait that ended with a tool without duration is a pause that may hide tool work', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.toolStarted('10:10', { toolUseId: 't1' }),
      ev.waiting('10:10', { reason: 'permission' }),
      ev.toolUsed('11:30', { toolUseId: 't1' }),
      ev.stop('11:30'),
    ]);
    expect(result.agents).toBe(10);
    expect(result.uncertainty).toBe(80);
  });

  it('is zero when every decision is clear-cut', () => {
    const events = [
      ev.sessionStarted('09:55'),
      ev.prompt('10:00'),
      ev.toolStarted('10:05', { toolUseId: 't1' }),
      ev.waiting('10:05'),
      ev.toolUsed('10:50', { toolUseId: 't1', durationMs: 40 * 60_000 }),
      ev.stop('10:52'),
      ev.prompt('11:00'),
      ev.stop('11:10'),
      ev.prompt('13:00'),
      ev.stop('13:05'),
      ev.sessionEnded('13:10'),
    ];
    const result = measure(events);
    expect(result.uncertainty).toBe(0);
    expect(result).toMatchObject({ agents: 62, user: 23 });
    expect(result.report.exceedsUncertaintyTarget).toBe(false);
  });

  it('has no share while the fact is zero', () => {
    const result = measure([]);
    expect(result.fact).toBe(0);
    expect(result.report.uncertaintyShare).toBeUndefined();
    expect(result.report.manualShare).toBeUndefined();
  });
});

describe('auxiliary metrics', () => {
  it('a background subagent adds to agent time and work', () => {
    const events = [
      ev.prompt('10:00'),
      ev.agentStarted('10:10', 'a1', { background: true }),
      ev.stop('10:30'),
      ...['10:30', '10:50', '11:05'].map((time) => ev.toolUsed(time, { agent: 'a1' })),
      ev.agentStopped('11:10', 'a1'),
    ];
    expect(measure(events)).toMatchObject({ agents: 70, work: 90 });
  });

  it('a subagent without agent.started runs from its first event', () => {
    const events = [ev.prompt('10:00'), ev.toolUsed('10:10'), ev.stop('10:30'), ev.toolUsed('10:40', { agent: 'a1' }), ev.agentStopped('11:00', 'a1')];
    expect(measure(events)).toMatchObject({ agents: 50, work: 50 });
  });

  it('sequential equivalent and parallel flag come from the parallel periods', () => {
    const parallel: ParallelPeriod[] = [
      { enabledAt: at('10:00').toISOString(), disabledAt: at('10:30').toISOString(), change: { agents: 2, parts: [] } },
      { enabledAt: at('11:00').toISOString(), change: { agents: 3, parts: [] } },
    ];
    const events = [ev.prompt('10:00'), ev.agentStarted('10:00', 'a1', { background: true }), ev.stop('10:30'), ev.agentStopped('10:30', 'a1')];
    const { report } = measure(events, { parallel, now: '12:00' });
    expect(report.parallel).toEqual({ used: true, maxAgents: 3 });
    expect(report.sequentialEquivalent?.minutes).toBe(60);
    expect(report.calendar.minutes).toBe(240);
    expect(measure(events).report.sequentialEquivalent).toBeUndefined();
  });
});

describe('hooks running in parallel and turn ids', () => {
  const T = (iso: string) => `2026-10-27T${iso}Z`;

  it('a tool end that arrives before its start does not leave the tool running', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.toolUsed(T('10:05:00.100'), { toolUseId: 't1' }),
      ev.toolStarted(T('10:05:00.150'), { toolUseId: 't1' }),
      ev.stop('11:30'),
    ]);
    expect(result.agents).toBeCloseTo(5, 1);
  });

  it('a late end of an earlier turn does not close the next one', () => {
    const result = measure([
      ev.prompt('10:00', { turn: 'p1' }),
      ev.toolUsed('10:19'),
      ev.automated(T('10:20:00.000'), { turn: 'p2' }),
      ev.stop(T('10:20:00.200'), { turn: 'p1' }),
      ev.toolUsed('10:25'),
      ev.stop('10:30', { turn: 'p2' }),
    ]);
    // p1 did end — its end only arrived 200 ms late — so it runs to 10:20 rather than being cut at 10:19.
    expect(result.agents).toBeCloseTo(30, 1);
    expect(result.uncertainty).toBe(4); // only the 19 silent minutes of p1, not an abandoned turn
  });

  it('a permission prompt before the start of its call keeps the wait going', () => {
    const result = measure([
      ev.prompt('10:00'),
      ev.waiting(T('10:10:00.000'), { reason: 'permission' }),
      ev.toolStarted(T('10:10:00.100'), { toolUseId: 't1' }),
      ev.toolUsed('11:40', { toolUseId: 't1', durationMs: 600_000 }),
      ev.stop('11:40'),
    ]);
    expect(result.agents).toBeCloseTo(20, 1); // 10:00–10:10 and 11:30–11:40; 80 minutes of waiting are a pause
  });

  it('a message delivered mid-turn continues the turn, whoever sent it', () => {
    for (const origin of ['automated', 'user'] as const) {
      const result = measure([
        ev.sessionStarted('09:59'),
        ev.prompt('10:00', { turn: 'p1' }),
        ev.toolUsed('10:10'),
        activity('turn.started', '10:12', { origin, turn: 'p1' }),
        ev.toolUsed('10:20'),
        ev.stop('10:30', { turn: 'p1' }),
        ev.sessionEnded('10:30'),
      ]);
      expect(result).toMatchObject({ agents: 30, user: 1 });
    }
  });

  it('a session switched to another task splits the turn between the tasks without loss', () => {
    const first = measure([ev.prompt('10:00'), ev.toolUsed('10:10'), ev.toolUsed('10:18'), activity('session.unbound', '10:20')]);
    const second = measure([activity('session.bound', '10:20'), ev.toolUsed('10:25'), ev.toolUsed('10:35'), ev.stop('10:40')]);
    expect(first.agents).toBe(20);
    expect(second.agents).toBe(20);
    expect(second.user).toBe(0);
  });

  it('a session bound while the user has it opens the user span', () => {
    expect(measure([activity('session.bound', '10:00'), ev.prompt('10:10'), ev.stop('10:20')])).toMatchObject({ user: 10, agents: 10 });
  });
});

describe('subagents that stop, resume and turn out to run in the background', () => {
  it('a resumed subagent gets a second interval', () => {
    const result = measure([ev.agentStarted('10:00', 'a1'), ev.agentStopped('10:05', 'a1'), ev.agentStarted('10:20', 'a1'), ev.agentStopped('10:30', 'a1')]);
    expect(result.agents).toBe(15);
  });

  it('agent.detached makes a subagent background after its start, and the flag sticks after a resume', () => {
    const events = [
      ev.prompt('10:00'),
      ev.toolStarted('10:10', { toolUseId: 'spawn' }),
      ev.agentStarted('10:10', 'a1'),
      activity('agent.detached', '10:10', { agent: 'a1' }),
      ev.toolUsed('10:10', { toolUseId: 'spawn' }),
      ev.toolStarted('10:11', { toolUseId: 'build' }), // the main agent keeps working meanwhile
      ev.toolUsed('10:40', { agent: 'a1' }),
      ev.agentStopped('10:50', 'a1'),
      ev.toolUsed('10:59', { toolUseId: 'build' }),
      ev.stop('11:00'),
    ];
    // Background: 60 of the main agent + 40 of a1; as a foreground child a1 would replace the main agent's 40.
    expect(measure(events)).toMatchObject({ agents: 60, work: 100 });
    // Resumed inside a later turn without `background`: still background, so the main agent's time is not replaced.
    const resumed = measure([
      ...events,
      ev.prompt('11:05'),
      ev.toolStarted('11:06', { toolUseId: 'b2' }),
      ev.agentStarted('11:10', 'a1'),
      ev.agentStopped('11:20', 'a1'),
      ev.toolUsed('11:29', { toolUseId: 'b2' }),
      ev.stop('11:30'),
    ]);
    expect(resumed.work).toBe(100 + 25 + 10);
  });

  it('agent.detached does not open or move an interval of the subagent', () => {
    const result = measure([activity('agent.detached', '09:00', { agent: 'a1' }), ev.agentStarted('10:00', 'a1'), ev.agentStopped('10:10', 'a1')]);
    expect(result.agents).toBe(10);
  });
});
