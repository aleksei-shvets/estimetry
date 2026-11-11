import type { EventEnvelope } from '../shared/event-envelope.js';
import type { LogBoundaries } from '../measurement/log-boundaries.js';
import { Timestamp } from '../shared/timestamp.js';

/*
 * Records of a session log in a task's journal (session-log-import spec). Each
 * import adds what is new since the previous one, read from a byte offset of
 * the log file; a later record wins where they overlap. Times are milliseconds since the epoch.
 */

export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

/** Tokens of one model whose messages started in the five minutes from `at`. */
export interface TokenBucket extends TokenCounts {
  readonly at: number;
  readonly model: string;
}

/** A turn of the main agent keyed by the offset of its first line; the part before the first turn of a read has no times. */
export interface LogTurn {
  readonly key: number;
  readonly start?: number;
  readonly end?: number;
  readonly tokens: readonly TokenBucket[];
}

export interface LogAgent {
  readonly agent: string;
  readonly spans: readonly (readonly [number, number])[];
  readonly tokens: readonly TokenBucket[];
}

export interface CostTotal {
  readonly startTime: number;
  readonly totalUSD: number;
  readonly unknown: boolean;
}

export interface LogSessionData {
  readonly source: string;
  readonly session: string;
  /** Parts of one import share it; an import counts only with all its parts. */
  readonly importId: string;
  /** Byte offset of the log file the import read from. */
  readonly from: number;
  readonly part: number;
  readonly parts: number;
  readonly turns: readonly LogTurn[];
  readonly agents: readonly LogAgent[];
  readonly cost: readonly CostTotal[];
  readonly skipped: number;
}

export type LogSession = EventEnvelope<'log.session', LogSessionData>;

/** What the journal knows of one session's log after all its imports. */
export interface SessionLog {
  readonly session: string;
  readonly turns: readonly LogTurn[];
  readonly agents: ReadonlyMap<string, LogAgent>;
  /** By process start; the last total of each. */
  readonly cost: ReadonlyMap<number, CostTotal>;
}

/** A closing of the task: records written while it stayed closed do not count. */
export interface ClosedPeriod {
  /** The closing moment; it may be backdated. */
  readonly at: Timestamp;
  /** When the closing was written: records after it and before the reopening are ignored. */
  readonly recordedAt?: Timestamp;
  readonly reopenedAt?: Timestamp;
}

/**
 * Merges the complete imports of every session in journal order. A record
 * written after a closing and before the reopening is ignored, so the fact at
 * the closing and after `emt rebuild` is the same.
 */
export function sessionLogs(records: readonly LogSession[], closed: readonly ClosedPeriod[] = []): Map<string, SessionLog> {
  const ignored = (record: LogSession) => {
    const ts = Timestamp.parse(record.ts).toMillis();
    return closed.some(
      (period) =>
        ts > (period.recordedAt ?? period.at).toMillis() && (period.reopenedAt === undefined || ts < period.reopenedAt.toMillis()),
    );
  };
  const inForce = records.filter((record) => !ignored(record));
  const imports = new Map<string, LogSession[]>();
  for (const record of inForce) {
    const id = `${record.data.session}\u0000${record.data.importId}`;
    imports.set(id, [...(imports.get(id) ?? []), record]);
  }
  const merged = new Map<string, { turns: LogTurn[]; agents: Map<string, LogAgent>; cost: Map<number, CostTotal> }>();
  for (const parts of imports.values()) {
    const first = parts[0];
    if (first === undefined || !complete(parts)) {
      continue; // a write cut short: the next import reads the same stretch again
    }
    const { session, from } = first.data;
    const log = merged.get(session) ?? { turns: [], agents: new Map(), cost: new Map() };
    log.turns = [...log.turns.filter((turn) => turn.key < from), ...joinedTurns(parts.flatMap((part) => part.data.turns))];
    for (const agent of joinedAgents(parts.flatMap((part) => part.data.agents))) {
      log.agents.set(agent.agent, agent);
    }
    for (const part of parts) {
      for (const total of part.data.cost) {
        log.cost.set(total.startTime, total);
      }
    }
    merged.set(session, log);
  }
  return new Map([...merged].map(([session, log]) => [session, { session, ...log }]));
}

/** A turn too large for one record comes in pieces of one import with the same key; the first piece has its times. */
function joinedTurns(turns: readonly LogTurn[]): LogTurn[] {
  const byKey = new Map<number, LogTurn>();
  for (const turn of turns) {
    const before = byKey.get(turn.key);
    byKey.set(
      turn.key,
      before === undefined
        ? turn
        : {
            ...before,
            ...(before.start === undefined && turn.start !== undefined ? { start: turn.start } : {}),
            ...(before.end === undefined && turn.end !== undefined ? { end: turn.end } : {}),
            tokens: [...before.tokens, ...turn.tokens],
          },
    );
  }
  return [...byKey.values()];
}

function joinedAgents(agents: readonly LogAgent[]): LogAgent[] {
  const byId = new Map<string, LogAgent>();
  for (const agent of agents) {
    const before = byId.get(agent.agent);
    byId.set(
      agent.agent,
      before === undefined
        ? agent
        : { agent: agent.agent, spans: [...before.spans, ...agent.spans], tokens: [...before.tokens, ...agent.tokens] },
    );
  }
  return [...byId.values()];
}

function complete(parts: readonly LogSession[]): boolean {
  const expected = parts[0]?.data.parts ?? 0;
  const seen = new Set(parts.map((part) => part.data.part));
  return seen.size === expected && [...seen].every((part) => part >= 1 && part <= expected);
}

/** Turn and subagent boundaries for the calculator, by session. */
export function logBoundaries(logs: ReadonlyMap<string, SessionLog>): Map<string, LogBoundaries> {
  const result = new Map<string, LogBoundaries>();
  for (const [session, log] of logs) {
    const turns = log.turns
      .flatMap((turn) => (turn.start === undefined || turn.end === undefined ? [] : [{ start: turn.start, end: turn.end }]))
      .sort((a, b) => a.start - b.start);
    result.set(session, { turns, agents: new Map([...log.agents].map(([agent, data]) => [agent, data.spans])) });
  }
  return result;
}
