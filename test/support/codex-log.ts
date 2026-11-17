import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Synthetic rollouts of Codex in the shape of real ones (codex-cli 0.160–0.163): a line per record,
 * `{"timestamp", "type", "payload"}`. Texts are placeholders; a test checks that none of them leaves the reader.
 */

export const SECRET = 'SECRET-TEXT-OF-THE-SESSION';

type Line = Record<string, unknown>;
/** A time of day on 2026-11-17, or a whole ISO moment. */
const at = (time: string) => (time.includes('T') ? time : `2026-11-17T${time}.000Z`);

export const rollout = {
  meta: (thread: string, time: string, parent?: string): Line => ({
    timestamp: at(time),
    type: 'session_meta',
    payload: {
      id: thread,
      session_id: parent ?? thread,
      timestamp: at(time),
      cwd: '/work/app',
      base_instructions: { text: SECRET },
      ...(parent === undefined ? { source: 'cli' } : { parent_thread_id: parent, source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } } }),
    },
  }),
  turnContext: (time: string, turn: string, model: string): Line => ({ timestamp: at(time), type: 'turn_context', payload: { turn_id: turn, model, cwd: '/work/app' } }),
  started: (time: string, turn: string): Line => ({ timestamp: at(time), type: 'event_msg', payload: { type: 'task_started', turn_id: turn } }),
  complete: (time: string, turn: string): Line => ({
    timestamp: at(time),
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: turn, last_agent_message: SECRET },
  }),
  aborted: (time: string, turn: string): Line => ({ timestamp: at(time), type: 'event_msg', payload: { type: 'turn_aborted', turn_id: turn, reason: 'interrupted' } }),
  message: (time: string): Line => ({ timestamp: at(time), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: SECRET }] } }),
  usage: (time: string, response: string, counts: { input?: number; cached?: number; output?: number; cacheWrite?: number }): Line => ({
    timestamp: at(time),
    type: 'token_usage_record',
    payload: {
      response_id: response,
      usage: {
        input_tokens: counts.input ?? 0,
        cached_input_tokens: counts.cached ?? 0,
        cache_write_input_tokens: counts.cacheWrite ?? 0,
        output_tokens: counts.output ?? 0,
        reasoning_output_tokens: 0,
      },
    },
  }),
  tokenCount: (time: string, counts: { input?: number; cached?: number; output?: number }): Line => ({
    timestamp: at(time),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: { input_tokens: counts.input ?? 0, cached_input_tokens: counts.cached ?? 0, output_tokens: counts.output ?? 0 } },
    },
  }),
  subagent: (time: string, child: string, kind: 'started' | 'completed'): Line => ({
    timestamp: at(time),
    type: 'event_msg',
    payload: { type: 'item_completed', item: { type: 'SubAgentActivity', kind, agent_thread_id: child, agent_path: `/root/${SECRET}` } },
  }),
};

export function rolloutText(lines: readonly (Line | string)[]): string {
  return lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n';
}

/** Writes a rollout where Codex keeps it: `<home>/sessions/2026/11/17/rollout-…-<thread>.jsonl`. */
export function writeRollout(home: string, thread: string, lines: readonly (Line | string)[], day = ['2026', '11', '17']): string {
  const dir = join(home, 'sessions', ...day);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `rollout-2026-11-17T10-00-00-${thread}.jsonl`);
  writeFileSync(path, rolloutText(lines));
  return path;
}
