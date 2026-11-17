import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
const DAY_MS = 24 * 60 * 60_000;

/**
 * Session logs of Codex: rollouts in `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl`, one
 * per thread; a subagent writes its own and its parent names it in `SubAgentActivity` items. The fingerprint is the
 * parent's file alone: a subagent that changes also adds to its parent, and every read takes the subagents named in
 * the part it reads. A compressed rollout (`.jsonl.zst`, older than a week) is not read: Node 22 has no zstd.
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
      for (const [agent, startedAt] of parser.subagents) {
        const file = this.childFile(agent, startedAt);
        if (file === undefined) {
          continue;
        }
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

  /** The rollout of a subagent, in the day directory of its start or a day around it (directories use local dates). */
  private childFile(agent: string, startedAt: number): string | undefined {
    const days = [startedAt - DAY_MS, startedAt, startedAt + DAY_MS].map((at) => {
      const day = new Date(at).toISOString().slice(0, 10).split('-');
      return join(this.home, 'sessions', ...day);
    });
    return this.find(`-${agent}.jsonl`, days);
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
