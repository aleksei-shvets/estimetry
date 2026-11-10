import type { ActivityDraft, HookAdapter, HookKind, HookTranslation } from '../../../application/contracts/hook-adapter.js';
import { SessionId } from '../../../domain/measurement/session-id.js';
import { InvalidValue } from '../../../domain/shared/domain-error.js';
import { CLAUDE_CODE_HOOK_EVENTS } from './hook-events.js';

/*
 * Claude Code hook payloads → activity events (claude-code-hooks spec). Prompt
 * texts, tool inputs and outputs are read only to classify the call and never
 * leave this module. Kept apart from the installer, so the hook receiver does
 * not load skill texts and settings merging on every tool call.
 */

/** Tools that wait for the user's answer rather than doing work. */
const QUESTION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode']);
/** The tool that starts subagents; older versions called it Task. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);
/** Markup Claude Code puts in front of messages it delivers as prompts by itself. */
const AUTOMATED_PROMPT = /^\s*<(task-notification|agent-message)[\s>]/;
const QUESTION_NOTIFICATIONS: ReadonlySet<string> = new Set(['elicitation_dialog', 'elicitation_url_dialog']);

const KINDS: Readonly<Record<string, HookKind>> = {
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
  UserPromptSubmit: 'prompt',
  Stop: 'turn-end',
  StopFailure: 'turn-end',
  PostToolUse: 'tool-done',
  PostToolUseFailure: 'tool-done',
};

type Json = Record<string, unknown>;

export const claudeCodeHooks: HookAdapter = {
  id: 'claude-code',
  aliases: ['claude'],
  hookEvents: CLAUDE_CODE_HOOK_EVENTS,

  translate(event: string, payload: unknown): HookTranslation {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new InvalidValue(`claude-code ${event}: stdin is not a JSON object`);
    }
    const p = payload as Json;
    if (typeof p['session_id'] !== 'string') {
      throw new InvalidValue(`claude-code ${event}: session_id is missing`);
    }
    const session = SessionId.parse(p['session_id']);
    const cwd = typeof p['cwd'] === 'string' ? p['cwd'] : undefined;
    const transcript = typeof p['transcript_path'] === 'string' && p['transcript_path'] !== '' ? p['transcript_path'] : undefined;
    return {
      session,
      ...(cwd === undefined ? {} : { cwd }),
      ...(transcript === undefined ? {} : { transcript }),
      kind: KINDS[event] ?? 'other',
      events: translateEvent(event, p),
    };
  },

  renderContext(event: string, text: string): string {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
  },
};

function translateEvent(event: string, p: Json): ActivityDraft[] {
  const agent = text(p['agent_id']);
  const onAgent = agent === undefined ? {} : { agent };
  const turn = agent === undefined && text(p['prompt_id']) !== undefined ? { turn: text(p['prompt_id']) as string } : {};
  const tool = text(p['tool_name']);
  const toolUseId = text(p['tool_use_id']);
  const call = { ...onAgent, ...(tool === undefined ? {} : { tool }), ...(toolUseId === undefined ? {} : { toolUseId }) };

  switch (event) {
    case 'SessionStart': {
      const source = text(p['source']);
      if (agent !== undefined || source === 'clear' || source === 'compact') {
        return []; // a subagent's start, or the same session going on
      }
      return [{ type: 'session.started', data: source === 'startup' || source === undefined ? {} : { resumed: true } }];
    }
    case 'SessionEnd':
      return [{ type: 'session.ended', data: {} }];
    case 'UserPromptSubmit': {
      const prompt = typeof p['prompt'] === 'string' ? p['prompt'] : '';
      return [{ type: 'turn.started', data: { origin: AUTOMATED_PROMPT.test(prompt) ? 'automated' : 'user', ...turn } }];
    }
    case 'Stop':
      return [{ type: 'turn.ended', data: { outcome: 'completed', ...turn } }];
    case 'StopFailure':
      return [{ type: 'turn.ended', data: { outcome: 'error', ...turn } }];
    case 'PreToolUse':
      return tool !== undefined && QUESTION_TOOLS.has(tool)
        ? [{ type: 'turn.awaiting-input', data: { ...onAgent, reason: 'question', ...turn } }]
        : [{ type: 'tool.started', data: call }];
    case 'PermissionRequest':
      return tool !== undefined && QUESTION_TOOLS.has(tool) ? [] : [{ type: 'turn.awaiting-input', data: { ...onAgent, reason: 'permission', ...turn } }];
    case 'Notification': {
      const type = text(p['notification_type']);
      return type !== undefined && QUESTION_NOTIFICATIONS.has(type) ? [{ type: 'turn.awaiting-input', data: { ...onAgent, reason: 'question', ...turn } }] : [];
    }
    case 'PostToolUse': {
      const used: ActivityDraft = { type: 'tool.used', data: { ...call, ...duration(p) } };
      const response = p['tool_response'];
      const launched =
        tool !== undefined && SUBAGENT_TOOLS.has(tool) && typeof response === 'object' && response !== null
          ? (response as Json)
          : undefined;
      const child = launched?.['status'] === 'async_launched' ? text(launched['agentId']) : undefined;
      return child === undefined ? [used] : [used, { type: 'agent.detached', data: { agent: child } }];
    }
    case 'PostToolUseFailure': {
      const used: ActivityDraft = { type: 'tool.used', data: { ...call, ...duration(p), failed: true } };
      return p['is_interrupt'] === true && agent === undefined
        ? [used, { type: 'turn.ended', data: { outcome: 'interrupted', ...turn } }]
        : [used];
    }
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

function duration(p: Json): { durationMs?: number } {
  const value = typeof p['duration_ms'] === 'string' ? Number(p['duration_ms']) : p['duration_ms'];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { durationMs: Math.round(value) } : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
