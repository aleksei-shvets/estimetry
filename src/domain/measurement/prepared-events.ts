import { Timestamp } from '../shared/timestamp.js';
import type { ActivityEvent } from './activity-events.js';
import { key, MAIN, push } from './timeline.js';

/** Repeated deliveries of one hook arrive within this window. */
const DUPLICATE_WINDOW_MS = 2_000;

/** An activity event with its time in milliseconds. */
export interface Prepared {
  readonly event: ActivityEvent;
  readonly at: number;
}

/**
 * Orders events by time (journal order breaks ties) and drops repeated deliveries:
 * a hook installed twice delivers the same event right after the first copy,
 * before the next event of its agent, so a repeat is a copy of the previous event
 * of the same agent, not of any earlier one.
 */
export function prepare(events: readonly ActivityEvent[]): Prepared[] {
  const sorted = events
    .map((event, index) => ({ event, at: Timestamp.parse(event.ts).toMillis(), index }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const previous = new Map<string, { duplicateKey: string | undefined; at: number }>();
  /** Copies with the very same time can be split by the tie order, so they are matched by key and time alone. */
  const sameTime = new Set<string>();
  const result: Prepared[] = [];
  for (const item of sorted) {
    const stream = key(item.event.data.session, agentOf(item.event) ?? MAIN);
    const duplicateKey = duplicateKeyOf(item.event);
    if (duplicateKey !== undefined) {
      const last = previous.get(stream);
      const exact = `${stream} ${duplicateKey} ${item.at}`;
      if (sameTime.has(exact) || (last?.duplicateKey === duplicateKey && item.at - last.at <= DUPLICATE_WINDOW_MS)) {
        continue;
      }
      sameTime.add(exact);
    }
    previous.set(stream, { duplicateKey, at: item.at });
    result.push({ event: item.event, at: item.at });
  }
  return result;
}

/** Two quick calls of the same tool are normal, so tool events without an id are never treated as repeats. */
function duplicateKeyOf(event: ActivityEvent): string | undefined {
  const toolUseId = 'toolUseId' in event.data ? event.data.toolUseId : undefined;
  if ((event.type === 'tool.started' || event.type === 'tool.used') && toolUseId === undefined) {
    return undefined;
  }
  return toolUseId === undefined ? event.type : `${event.type}\u0000${toolUseId}`;
}

/** Events grouped by session, in their order. */
export function bySession(items: readonly Prepared[]): Map<string, Prepared[]> {
  const sessions = new Map<string, Prepared[]>();
  for (const item of items) {
    push(sessions, item.event.data.session, item);
  }
  return sessions;
}

/** The subagent of an event; undefined for the main agent. */
export function agentOf(event: ActivityEvent): string | undefined {
  return 'agent' in event.data ? event.data.agent : undefined;
}
