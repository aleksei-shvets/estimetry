import { parseActivityEvent, type ActivityEvent, type ActivityEventType } from '../../src/domain/measurement/activity-events.js';

const MINUTE = 60_000;

/** Small deterministic PRNG (mulberry32), so a failing seed can be replayed. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface GeneratedSession {
  readonly events: ActivityEvent[];
  readonly first: number;
  readonly last: number;
}

/**
 * A synthetic session of the main agent with every kind of event the
 * calculator handles: user and automated turns, tools that fail to report
 * back, permission waits, questions, interruptions, compaction and stray
 * notifications. Turns carry ids and sometimes get a message mid-turn.
 * Most events are seconds apart; some come within a fraction of a second, as
 * asynchronous hooks do (a fast tool, a permission prompt right after its call,
 * an automated turn right after the previous one), so time jitter can swap them.
 */
export function generateSession(seed: number, session = 's1', startMillis = Date.parse('2026-10-27T08:00:00.000Z')): GeneratedSession {
  const rand = random(seed);
  const events: ActivityEvent[] = [];
  let now = startMillis;
  let tools = 0;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const gap = (): number => {
    const r = rand();
    const minutes = r < 0.7 ? 0.1 + rand() * 10 : r < 0.9 ? 10 + rand() * 30 : 40 + rand() * 160;
    return Math.round(minutes * MINUTE);
  };
  /** `spacing` is the minimum distance from the previous event. */
  const emit = (type: ActivityEventType, data: Record<string, unknown> = {}, wait = 0, spacing = 5_000): number => {
    now += spacing + wait;
    events.push(
      parseActivityEvent({
        schemaVersion: 1,
        id: `${session}-${events.length}`,
        ts: new Date(now).toISOString(),
        type,
        author: 'dev@example.com',
        task: 'T-1',
        project: 'api',
        data: { source: 'generator', session, ...data },
      }),
    );
    return now;
  };

  if (rand() < 0.8) {
    emit('session.started');
  }
  const turns = 1 + Math.floor(rand() * 8);
  let followsClosely = false;
  for (let turn = 0; turn < turns; turn++) {
    const id = `${session}-p${turn}`;
    if (followsClosely) {
      emit('turn.started', { origin: 'automated', turn: id }, 0, 200);
    } else {
      emit('turn.started', { origin: rand() < 0.8 ? 'user' : 'automated', turn: id }, gap());
    }
    const calls = Math.floor(rand() * 5);
    for (let call = 0; call < calls; call++) {
      const toolUseId = `t${(tools += 1)}`;
      switch (pick(['normal', 'normal', 'fast', 'failed', 'permission', 'question', 'mid-turn'] as const)) {
        case 'normal':
          emit('tool.started', { toolUseId }, gap());
          emit('tool.used', { toolUseId, ...(rand() < 0.5 ? { durationMs: 1_000 } : {}) }, gap());
          break;
        case 'fast':
          emit('tool.started', { toolUseId }, gap());
          emit('tool.used', { toolUseId, durationMs: 30 }, 0, 50);
          break;
        case 'mid-turn':
          // A subagent report or a queued prompt delivered while the turn runs.
          emit('turn.started', { origin: rand() < 0.5 ? 'automated' : 'user', turn: id }, gap());
          break;
        case 'failed':
          emit('tool.started', { toolUseId }, gap());
          break;
        case 'permission': {
          emit('tool.started', { toolUseId }, gap());
          emit('turn.awaiting-input', { reason: 'permission' }, 0, rand() < 0.5 ? 100 : 5_000);
          const wait = gap();
          // The tool's own run is some part of the time since the prompt; sometimes the tool does not say.
          const durationMs = Math.floor(rand() * (wait + 5_000));
          emit('tool.used', { toolUseId, ...(rand() < 0.7 ? { durationMs } : {}) }, wait);
          break;
        }
        case 'question':
          emit('turn.awaiting-input', { reason: 'question' }, gap());
          break;
      }
      if (rand() < 0.05) {
        emit('session.started', {}, gap());
      }
    }
    followsClosely = false;
    if (rand() < 0.8) {
      emit('turn.ended', { turn: id }, gap());
      if (rand() < 0.1) {
        emit('turn.awaiting-input', {}, gap());
      } else {
        followsClosely = rand() < 0.15;
      }
    }
  }
  if (rand() < 0.7) {
    emit('session.ended', {}, gap());
  }
  return { events, first: startMillis + 5_000, last: now };
}
