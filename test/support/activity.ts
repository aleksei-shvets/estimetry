import { parseActivityEvent, type ActivityEvent, type ActivityEventType } from '../../src/domain/measurement/activity-events.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';

export const DAY = '2026-10-27';

/** `10:25` or `10:25:30` on the test day, or a full ISO time. */
export function at(time: string): Timestamp {
  return Timestamp.parse(time.includes('T') ? time : `${DAY}T${time.length === 5 ? `${time}:00` : time}.000Z`);
}

let seq = 0;

/** A valid activity event of the main agent of session `s1` unless `data` says otherwise. */
export function activity(
  type: ActivityEventType,
  time: string,
  data: Record<string, unknown> = {},
  task = 'T-1',
): ActivityEvent {
  seq += 1;
  return parseActivityEvent({
    schemaVersion: 1,
    id: `a-${seq}`,
    ts: at(time).toISOString(),
    type,
    author: 'dev@example.com',
    task,
    project: 'api',
    data: { source: 'test', session: 's1', ...data },
  });
}

/** Shorthands for the events tests use most. */
export const ev = {
  sessionStarted: (time: string, data: Record<string, unknown> = {}) => activity('session.started', time, data),
  sessionEnded: (time: string, data: Record<string, unknown> = {}) => activity('session.ended', time, data),
  prompt: (time: string, data: Record<string, unknown> = {}) => activity('turn.started', time, { origin: 'user', ...data }),
  automated: (time: string, data: Record<string, unknown> = {}) =>
    activity('turn.started', time, { origin: 'automated', ...data }),
  stop: (time: string, data: Record<string, unknown> = {}) => activity('turn.ended', time, data),
  waiting: (time: string, data: Record<string, unknown> = {}) => activity('turn.awaiting-input', time, data),
  toolStarted: (time: string, data: Record<string, unknown> = {}) => activity('tool.started', time, data),
  toolUsed: (time: string, data: Record<string, unknown> = {}) => activity('tool.used', time, data),
  agentStarted: (time: string, agent: string, data: Record<string, unknown> = {}) =>
    activity('agent.started', time, { agent, ...data }),
  agentStopped: (time: string, agent: string, data: Record<string, unknown> = {}) =>
    activity('agent.stopped', time, { agent, ...data }),
};
