import { describe, expect, it } from 'vitest';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { codexHooks } from '../../../src/integrations/tools/codex/hook-translation.js';
import { CODEX_HOOK_EVENTS } from '../../../src/integrations/tools/codex/hook-events.js';

const base = { session_id: '01a162ca-f1f0-7da1-9125-c703441d95a4', cwd: '/work/app', transcript_path: '/home/u/.codex/sessions/2026/11/17/rollout-x.jsonl', model: 'gpt-x' };
const translate = (event: string, extra: Record<string, unknown> = {}) => codexHooks.translate(event, { ...base, hook_event_name: event, ...extra });
const events = (event: string, extra: Record<string, unknown> = {}) => translate(event, extra).events;

describe('Codex hooks into activity events', () => {
  it('a turn: the prompt starts it, Stop ends it, both keyed by the turn id', () => {
    expect(events('UserPromptSubmit', { turn_id: 't1', prompt: 'secret' })).toEqual([{ type: 'turn.started', data: { origin: 'user', turn: 't1' } }]);
    expect(events('Stop', { turn_id: 't1', stop_hook_active: false, last_assistant_message: 'done' })).toEqual([
      { type: 'turn.ended', data: { outcome: 'completed', turn: 't1' } },
    ]);
    expect(events('Interrupt', { turn_id: 't2' })).toEqual([{ type: 'turn.ended', data: { outcome: 'interrupted', turn: 't2' } }]);
  });

  it('the session, its path of the log and its directory', () => {
    const start = translate('SessionStart', { source: 'startup' });
    expect(start).toMatchObject({ kind: 'session-start', cwd: '/work/app', transcript: base.transcript_path, events: [{ type: 'session.started', data: {} }] });
    expect(start.session.value).toBe(base.session_id);
    expect(events('SessionStart', { source: 'resume' })).toEqual([{ type: 'session.started', data: { resumed: true } }]);
    expect(events('SessionStart', { source: 'fork' })).toEqual([{ type: 'session.started', data: { resumed: true } }]);
    expect(events('SessionStart', { source: 'clear' })).toEqual([]);
    expect(events('SessionStart', { source: 'compact' })).toEqual([]);
    expect(translate('SessionEnd', { reason: 'other' })).toMatchObject({ kind: 'session-end', events: [{ type: 'session.ended', data: {} }] });
    expect(translate('Stop', { transcript_path: null })).not.toHaveProperty('transcript');
  });

  it('tools, permissions and questions', () => {
    const tool = { turn_id: 't1', tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'rm -rf build' } };
    expect(events('PreToolUse', tool)).toEqual([{ type: 'tool.started', data: { tool: 'Bash', toolUseId: 'c1' } }]);
    expect(translate('PostToolUse', { ...tool, tool_response: 'output' })).toMatchObject({
      kind: 'tool-done',
      events: [{ type: 'tool.used', data: { tool: 'Bash', toolUseId: 'c1' } }],
    });
    expect(events('PermissionRequest', tool)).toEqual([{ type: 'turn.awaiting-input', data: { reason: 'permission', turn: 't1' } }]);
    expect(events('PreToolUse', { turn_id: 't1', tool_name: 'request_user_input' })).toEqual([
      { type: 'turn.awaiting-input', data: { reason: 'question', turn: 't1' } },
    ]);
  });

  it('a subagent: its start, its tools and its turns on its own id, its stop', () => {
    expect(events('SubagentStart', { turn_id: 't1', agent_id: 'a1', agent_type: 'worker' })).toEqual([
      { type: 'agent.started', data: { agent: 'a1', agentType: 'worker' } },
    ]);
    expect(events('UserPromptSubmit', { turn_id: 't9', agent_id: 'a1', prompt: 'do it' })).toEqual([
      { type: 'turn.started', data: { agent: 'a1', origin: 'automated' } },
    ]);
    expect(events('PostToolUse', { agent_id: 'a1', tool_name: 'apply_patch', tool_use_id: 'c2' })).toEqual([
      { type: 'tool.used', data: { agent: 'a1', tool: 'apply_patch', toolUseId: 'c2' } },
    ]);
    expect(events('SubagentStop', { agent_id: 'a1', agent_transcript_path: '/x' })).toEqual([{ type: 'agent.stopped', data: { agent: 'a1' } }]);
    expect(events('SubagentStart', {})).toEqual([]);
    // A thread of a subagent starting is no start of the session.
    expect(events('SessionStart', { source: 'startup', agent_id: 'a1' })).toEqual([]);
  });

  it('no text of the payload leaves the translation', () => {
    const all = JSON.stringify(
      CODEX_HOOK_EVENTS.map((event) =>
        translate(event, { turn_id: 't', prompt: 'SECRET-PROMPT', tool_name: 'Bash', tool_input: { command: 'SECRET-COMMAND' }, tool_response: 'SECRET-OUTPUT', last_assistant_message: 'SECRET-ANSWER' }),
      ),
    );
    expect(all).not.toMatch(/SECRET/);
  });

  it('a payload that is not what Codex sends is an error without its content', () => {
    expect(() => codexHooks.translate('Stop', 'text')).toThrow(InvalidValue);
    expect(() => codexHooks.translate('Stop', { cwd: '/x', prompt: 'SECRET' })).toThrow(/codex Stop: session_id is missing/);
  });

  it('gives the context in the format of Codex and names skills with $', () => {
    expect(JSON.parse(codexHooks.renderContext('SessionStart', 'hello'))).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hello' },
    });
    expect(codexHooks.skillRef('emt-extra')).toBe('$emt-extra');
    expect(codexHooks.projectDirVariable).toBeUndefined();
    expect(codexHooks.sessionEndBudgetMs).toBeLessThan(3_000);
  });
});
