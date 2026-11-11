import { existsSync, readdirSync, statSync } from 'node:fs';
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
import { AgentLogParser, MainLogParser } from './log-parser.js';
import { logLines } from './log-lines.js';

const AGENT_FILE = /^agent-(.+)\.jsonl$/;

/**
 * Session logs of Claude Code: `<config>/projects/<folder>/<session>.jsonl`
 * and `<session>/subagents/agent-<id>.jsonl` next to it. The folder name
 * encodes the project path by an undocumented rule, so every folder is searched.
 */
export class ClaudeCodeLogs implements SessionLogReader {
  readonly id = 'claude-code';

  constructor(private readonly configDir: string) {}

  fingerprint(session: string, path?: string): SessionLogFingerprint | undefined {
    try {
      const main = this.locate(session, path);
      return main === undefined ? undefined : fingerprintOf(main);
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
      const fingerprint = fingerprintOf(main);
      const from = request.from <= fingerprint.main.size ? request.from : 0;
      const parser = new MainLogParser(from);
      const lines = logLines(main, from, over);
      for (let step = lines.next(); ; step = lines.next()) {
        if (step.done === true) {
          if (step.value === 'stopped') {
            return { status: 'over-budget' };
          }
          break;
        }
        parser.add(step.value.offset, step.value.text);
      }
      if (from === 0 && parser.records === 0) {
        return { status: 'no-data', fingerprint };
      }
      if (from === 0 && parser.recognized === 0) {
        return { status: 'unrecognized', fingerprint };
      }
      const agents: LogAgentData[] = [];
      for (const [agent, file] of agentFiles(main)) {
        const agentParser = new AgentLogParser();
        const agentLines = logLines(file, 0, over);
        for (let step = agentLines.next(); ; step = agentLines.next()) {
          if (step.done === true) {
            if (step.value === 'stopped') {
              return { status: 'over-budget' };
            }
            break;
          }
          agentParser.add(step.value.text);
        }
        agents.push({ agent, ...agentParser.result() });
      }
      const { turns, next, cost } = parser.result();
      return { status: 'read', from, next, turns, agents, cost, skipped: parser.skipped, fingerprint };
    } catch (error) {
      if (error instanceof SessionLogFailure) {
        throw error;
      }
      // Messages of fs and JSON errors carry paths and pieces of lines: only a code leaves.
      throw new SessionLogFailure('log-read-failed');
    }
  }

  private locate(session: string, path: string | undefined): string | undefined {
    if (path !== undefined && path !== '' && existsSync(path)) {
      return path;
    }
    const projects = join(this.configDir, 'projects');
    if (!existsSync(projects)) {
      return undefined;
    }
    for (const folder of readdirSync(projects)) {
      const candidate = join(projects, folder, `${session}.jsonl`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }
}

function agentFiles(main: string): [string, string][] {
  const dir = join(dirname(main), basename(main, '.jsonl'), 'subagents');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const match = AGENT_FILE.exec(name);
      return match?.[1] === undefined ? [] : [[match[1], join(dir, name)] as [string, string]];
    });
}

function fingerprintOf(main: string): SessionLogFingerprint {
  const agents: Record<string, FileFingerprint> = {};
  for (const [agent, file] of agentFiles(main)) {
    agents[agent] = stat(file);
  }
  return { main: stat(main), agents };
}

function stat(file: string): FileFingerprint {
  const info = statSync(file);
  return { size: info.size, mtimeMs: Math.round(info.mtimeMs) };
}
