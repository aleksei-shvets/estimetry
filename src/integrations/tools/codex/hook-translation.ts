import type { ActivityDraft, HookAdapter, HookKind, HookTranslation } from '../../../application/contracts/hook-adapter.js';
import { SessionId } from '../../../domain/measurement/session-id.js';
import { InvalidValue } from '../../../domain/shared/domain-error.js';
import { CODEX_HOOK_EVENTS, codexSkillRef } from './hook-events.js';

/*
 * Codex hook payloads → activity events (codex-hooks spec). Prompts, tool inputs and outputs and the last message of
 * the agent are never read beyond their presence and never leave this module. Kept apart from the installer, so the
 * hook receiver does not load skill texts and settings merging on every tool call.
 */

/** Tools that wait for the user's answer rather than doing work (checked on a live session, tasks.md 10.2). */
const QUESTION_TOOLS: ReadonlySet<string> = new Set(['request_user_input']);

const KINDS: Readonly<Record<string, HookKind>> = {
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
  UserPromptSubmit: 'prompt',
  Stop: 'turn-end',
  Interrupt: 'turn-end',
  PostToolUse: 'tool-done',
};

type Json = Record<string, unknown>;

export const codexHooks: HookAdapter = {
  kind: 'session',
  id: 'codex',
  aliases: ['openai-codex'],
  hookEvents: CODEX_HOOK_EVENTS,
  // Codex names no project root in the environment: the `cwd` of the payload decides.
  // It waits for SessionEnd at most 3 seconds; the import keeps a second for the rest of the hook.
  sessionEndBudgetMs: 2_000,

  translate(event: string, payload: unknown): HookTranslation {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new InvalidValue(`codex ${event}: stdin is not a JSON object`);
    }
    const p = payload as Json;
    if (typeof p['session_id'] !== 'string') {
      throw new InvalidValue(`codex ${event}: session_id is missing`);
    }
    const session = SessionId.parse(p['session_id']);
    const cwd = text(p['cwd']);
    const transcript = text(p['transcript_path']);
    return {
      session,
      ...(cwd === undefined ? {} : { cwd }),
      ...(transcript === undefined ? {} : { transcript }),
      kind: KINDS[event] ?? 'other',
      events: translateEvent(event, p),
    };
  },

  skillRef: codexSkillRef,
  renderContext(event: string, text: string): string {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
  },
};

function translateEvent(event: string, p: Json): ActivityDraft[] {
  // Inside a subagent Codex adds its thread id; the session id stays the root one.
  const agent = text(p['agent_id']);
  const onAgent = agent === undefined ? {} : { agent };
  const turnId = text(p['turn_id']);
  const turn = agent === undefined && turnId !== undefined ? { turn: turnId } : {};
  const tool = text(p['tool_name']);
  const toolUseId = text(p['tool_use_id']);
  const call = { ...onAgent, ...(tool === undefined ? {} : { tool }), ...(toolUseId === undefined ? {} : { toolUseId }) };

  switch (event) {
    case 'SessionStart': {
      const source = text(p['source']);
      if (source === 'clear' || source === 'compact') {
        return []; // the same session going on
      }
      return [{ type: 'session.started', data: source === 'resume' || source === 'fork' ? { resumed: true } : {} }];
    }
    case 'SessionEnd':
      return [{ type: 'session.ended', data: {} }];
    case 'UserPromptSubmit':
      // Codex sends no prompts of its own on behalf of the user; a subagent's prompt is written by its parent.
      return [{ type: 'turn.started', data: { ...onAgent, origin: agent === undefined ? 'user' : 'automated', ...turn } }];
    case 'Stop':
      return [{ type: 'turn.ended', data: { ...onAgent, outcome: 'completed', ...turn } }];
    case 'Interrupt':
      return [{ type: 'turn.ended', data: { ...onAgent, outcome: 'interrupted', ...turn } }];
    case 'PreToolUse':
      return tool !== undefined && QUESTION_TOOLS.has(tool)
        ? [{ type: 'turn.awaiting-input', data: { ...onAgent, reason: 'question', ...turn } }]
        : [{ type: 'tool.started', data: call }];
    case 'PermissionRequest':
      return [{ type: 'turn.awaiting-input', data: { ...onAgent, reason: 'permission', ...turn } }];
    case 'PostToolUse':
      return [{ type: 'tool.used', data: call }];
    case 'SubagentStart': {
      const type = text(p['agent_type']);
      return agent === undefined ? [] : [{ type: 'agent.started', data: { agent, ...(type === undefined ? {} : { agentType: type }) } }];
    }
    case 'SubagentStop':
      return agent === undefined ? [] : [{ type: 'agent.stopped', data: { agent } }];
    default:
      return [];
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
