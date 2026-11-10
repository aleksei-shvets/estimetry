import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAY } from './activity.js';

/*
 * Synthetic Claude Code session logs in the shape of the studied versions.
 * Every text in them carries SECRET, so a test can check that no text leaves the reader.
 */

export const SECRET = 'SECRET-fixture-text';

type Line = Record<string, unknown> | string;

/** `HH:MM` or `HH:MM:SS` on the test day, or a full ISO time as it is. */
const ts = (time: string) => (time.includes('T') ? time : `${DAY}T${time.length === 5 ? `${time}:00` : time}.000Z`);

let uuid = 0;
const base = (type: string, time: string | undefined) => ({
  type,
  ...(time === undefined ? {} : { timestamp: ts(time) }),
  uuid: `u${++uuid}`,
  sessionId: 's1',
  isSidechain: false,
  cwd: `/home/${SECRET}/project`,
});

export interface Usage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly write5m?: number;
  readonly write1h?: number;
  /** Older logs have no split of the cache write. */
  readonly noSplit?: boolean;
}

export const log = {
  prompt: (time: string, options: { origin?: string | null; compact?: boolean; meta?: boolean } = {}): Line => ({
    ...base('user', time),
    ...(options.origin === null ? {} : { turnOrigin: options.origin ?? 'human', turnPosition: 'start' }),
    ...(options.compact ? { isCompactSummary: true } : {}),
    ...(options.meta ? { isMeta: true } : {}),
    message: { role: 'user', content: `${SECRET} prompt` },
  }),
  toolResult: (time: string): Line => ({
    ...base('user', time),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `${SECRET} output` }] },
    toolUseResult: { stdout: SECRET },
  }),
  notification: (time: string): Line => ({
    ...base('user', time),
    message: { role: 'user', content: `<task-notification>${SECRET}</task-notification>` },
  }),
  interruption: (time: string): Line => ({
    ...base('user', time),
    message: { role: 'user', content: [{ type: 'text', text: `[Request interrupted by user] ${SECRET}` }] },
  }),
  assistant: (
    time: string,
    options: { id?: string; model?: string; stop?: 'end_turn' | 'tool_use' | null; usage?: Usage } = {},
  ): Line => {
    const usage = options.usage ?? {};
    return {
      ...base('assistant', time),
      message: {
        id: options.id ?? `m${uuid + 1}`,
        model: options.model ?? 'claude-opus-5-5',
        role: 'assistant',
        stop_reason: options.stop === undefined ? 'tool_use' : options.stop,
        content: [{ type: 'text', text: `${SECRET} answer` }, { type: 'tool_use', name: 'Bash', input: { command: SECRET } }],
        usage: {
          input_tokens: usage.input ?? 0,
          output_tokens: usage.output ?? 0,
          cache_read_input_tokens: usage.cacheRead ?? 0,
          cache_creation_input_tokens: (usage.write5m ?? 0) + (usage.write1h ?? 0),
          ...(usage.noSplit
            ? {}
            : { cache_creation: { ephemeral_5m_input_tokens: usage.write5m ?? 0, ephemeral_1h_input_tokens: usage.write1h ?? 0 } }),
        },
      },
    };
  },
  stopHook: (time: string): Line => ({ ...base('system', time), subtype: 'stop_hook_summary', hookInfos: [{ command: SECRET }] }),
  apiError: (time: string): Line => ({ ...base('system', time), subtype: 'api_error', error: SECRET }),
  cost: (startTime: number, totalUSD: number, unknown = false): Line => ({
    type: 'cost-state',
    sessionId: 's1',
    startTime,
    totalCostUSD: totalUSD,
    hasUnknownModelCost: unknown,
    modelUsage: { 'claude-opus-5-5[1m]': { costUSD: totalUSD } },
  }),
  service: (type: string, time?: string): Line => ({ ...base(type, time), note: SECRET }),
  broken: (): Line => `{"type":"user","message":"${SECRET}`,
};

export interface WrittenLog {
  readonly configDir: string;
  readonly path: string;
}

/** Writes `<config>/projects/<folder>/<session>.jsonl` and its subagent files; returns the paths. */
export function writeLog(
  root: string,
  lines: readonly Line[],
  options: { session?: string; folder?: string; agents?: Record<string, readonly Line[]> } = {},
): WrittenLog {
  const session = options.session ?? 's1';
  const folder = join(root, 'projects', options.folder ?? `-home-${SECRET}-project`);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${session}.jsonl`);
  writeFileSync(path, text(lines));
  for (const [agent, agentLines] of Object.entries(options.agents ?? {})) {
    const dir = join(folder, session, 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `agent-${agent}.jsonl`), text(agentLines));
    writeFileSync(join(dir, `agent-${agent}.meta.json`), JSON.stringify({ agentType: `${SECRET}-type`, description: SECRET }));
  }
  return { configDir: root, path };
}

export function text(lines: readonly Line[]): string {
  return lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n';
}
