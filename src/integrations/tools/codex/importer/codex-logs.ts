import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  SessionLogFailure,
  type LogAgentData,
  type SessionLogReader,
  type SessionLogRequest,
  type SessionLogResult,
} from '../../../../application/contracts/session-logs.js';
import type { FileFingerprint, SessionLogFingerprint } from '../../../../application/ports/log-import-state.js';
import type { SessionId } from '../../../../domain/measurement/session-id.js';
import { logLines } from '../../shared/log-lines.js';
import { RolloutParser } from './rollout-parser.js';

/** Day directories searched for a session without a path, newest first. */
const SEARCHED_DAYS = 62;
/** Days after the parent's in which its subagents may have started: a resumed session goes on for days. */
const SUBAGENT_DAYS = 14;
/** The first line of a rollout carries its instructions too; its `session_meta` is read up to this size. */
const META_BYTES = 256 * 1024;
/** The start of the first line, where its ids are. */
const HEAD_BYTES = 4 * 1024;

/**
 * Session logs of Codex: rollouts in `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl`, one
 * per thread. A subagent the agent spawned writes its own, whose `session_meta` names the root session and
 * `source.subagent.thread_spawn`; how the parent names it differs between versions of Codex, so the children are
 * found by their own first line, in the parent's day directory and the days after it. Internal subagents (`guardian`
 * reviews, `source.subagent.other`) are no work of the agent and are left out. The fingerprint is the parent's file
 * alone: a subagent that works also adds to its parent. A compressed rollout (`.jsonl.zst`, older than a week) is not
 * read: Node 22 has no zstd.
 */
export class CodexLogs implements SessionLogReader {
  readonly id = 'codex';

  /** `home` is `$CODEX_HOME`, else `~/.codex`. */
  constructor(private readonly home: string) {}

  fingerprint(session: SessionId, path?: string): SessionLogFingerprint | undefined {
    try {
      const main = this.locate(session, path);
      return main === undefined ? undefined : { main: stat(main), agents: {} };
    } catch {
      throw new SessionLogFailure('log-stat-failed');
    }
  }

  read(request: SessionLogRequest): SessionLogResult {
    const deadline = request.budgetMs === undefined ? Infinity : performance.now() + request.budgetMs;
    const over = () => performance.now() > deadline;
    try {
      const main = this.locate(request.session, request.path);
      if (main === undefined) {
        return { status: 'not-found' };
      }
      const fingerprint: SessionLogFingerprint = { main: stat(main), agents: {} };
      const from = request.from <= fingerprint.main.size ? request.from : 0;
      const parser = new RolloutParser(from);
      if (parse(main, from, parser, over) === 'stopped') {
        return { status: 'over-budget' };
      }
      if (from === 0 && parser.records === 0) {
        return { status: 'no-data', fingerprint };
      }
      if (from === 0 && (!parser.sessionMeta || parser.recognized === 0)) {
        return { status: 'unrecognized', fingerprint };
      }
      const agents: LogAgentData[] = [];
      for (const [agent, file] of spawnedChildren(main, request.session.value, this.home)) {
        const child = new RolloutParser(0);
        if (parse(file, 0, child, over) === 'stopped') {
          return { status: 'over-budget' };
        }
        agents.push({ agent, ...agentOf(child) });
      }
      const { turns, next } = parser.result();
      // No `cost`: Codex reports none, and the session counts in tokens only.
      return { status: 'read', from, next, turns, agents, skipped: parser.skipped, fingerprint };
    } catch (error) {
      if (error instanceof SessionLogFailure) {
        throw error;
      }
      // Messages of fs and JSON errors carry paths and pieces of lines: only a code leaves.
      throw new SessionLogFailure('log-read-failed');
    }
  }

  private locate(session: SessionId, path: string | undefined): string | undefined {
    if (path !== undefined && path !== '' && path.endsWith('.jsonl') && existsSync(path)) {
      return path;
    }
    return this.find(`-${session.value}.jsonl`, this.newestDays(SEARCHED_DAYS));
  }

  private find(suffix: string, days: readonly string[]): string | undefined {
    for (const day of days) {
      if (!existsSync(day)) {
        continue;
      }
      const name = readdirSync(day).find((file) => file.startsWith('rollout-') && file.endsWith(suffix));
      if (name !== undefined) {
        return join(day, name);
      }
    }
    return undefined;
  }

  /** Day directories of the sessions, newest first. */
  private newestDays(limit: number): string[] {
    const root = join(this.home, 'sessions');
    const children = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((name) => /^\d+$/.test(name)).sort().reverse() : []);
    const days: string[] = [];
    for (const year of children(root)) {
      for (const month of children(join(root, year))) {
        for (const day of children(join(root, year, month))) {
          days.push(join(root, year, month, day));
          if (days.length >= limit) {
            return days;
          }
        }
      }
    }
    return days;
  }
}

function parse(file: string, from: number, parser: RolloutParser, over: () => boolean): 'done' | 'stopped' {
  const lines = logLines(file, from, over);
  for (let step = lines.next(); ; step = lines.next()) {
    if (step.done === true) {
      return step.value;
    }
    parser.add(step.value.offset, step.value.text);
  }
}

/** A subagent: its turns as stretches of work, its tokens wherever they stand. */
function agentOf(child: RolloutParser): Omit<LogAgentData, 'agent'> {
  const { turns } = child.result();
  const spans = turns.flatMap((turn) => (turn.start === undefined || turn.end === undefined ? [] : [[turn.start, turn.end] as const]));
  return { spans, tokens: turns.flatMap((turn) => turn.tokens) };
}

function stat(file: string): FileFingerprint {
  const info = statSync(file);
  return { size: info.size, mtimeMs: Math.round(info.mtimeMs) };
}

/** Subagents the agent spawned in the session: rollouts of its day and the days after whose meta names the session. */
function spawnedChildren(main: string, session: string, home: string): [string, string][] {
  const children: [string, string][] = [];
  for (const day of daysFrom(dirname(main), home)) {
    for (const name of readdirSync(day).sort()) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl') || join(day, name) === main) {
        continue;
      }
      const meta = sessionMeta(join(day, name), session);
      const source = meta?.['source'];
      const spawned = isObject(source) && isObject(source['subagent']) && 'thread_spawn' in source['subagent'];
      if (meta !== undefined && meta['session_id'] === session && spawned && typeof meta['id'] === 'string') {
        children.push([meta['id'], join(day, name)]);
      }
    }
  }
  return children;
}

/** The day directory of the parent and the existing ones after it, up to SUBAGENT_DAYS. */
function daysFrom(dayDir: string, home: string): string[] {
  const [year, month, day] = [basename(dirname(dirname(dayDir))), basename(dirname(dayDir)), basename(dayDir)];
  const start = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(start) || !dayDir.startsWith(join(home, 'sessions'))) {
    return existsSync(dayDir) ? [dayDir] : []; // a rollout outside the day directories: its own directory only
  }
  return Array.from({ length: SUBAGENT_DAYS }, (_, i) => {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10).split('-');
    return join(home, 'sessions', ...date);
  }).filter((dir) => existsSync(dir));
}

/**
 * The `session_meta` payload of a rollout's first line when it names the session, else undefined. The ids come first
 * in the line, so a file of another session is passed after its first few kilobytes.
 */
function sessionMeta(file: string, session: string): Record<string, unknown> | undefined {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    const headRead = readSync(fd, head, 0, HEAD_BYTES, 0);
    if (!head.subarray(0, headRead).toString('utf8').includes(`"session_id":"${session}"`)) {
      return undefined;
    }
    const buffer = Buffer.alloc(META_BYTES);
    const read = readSync(fd, buffer, 0, META_BYTES, 0);
    const text = buffer.subarray(0, read).toString('utf8');
    const end = text.indexOf('\n');
    const record: unknown = JSON.parse(end < 0 ? text : text.slice(0, end));
    return isObject(record) && record['type'] === 'session_meta' && isObject(record['payload']) ? record['payload'] : undefined;
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
