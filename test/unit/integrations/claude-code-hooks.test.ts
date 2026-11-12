import { describe, expect, it } from 'vitest';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { CalendarDate } from '../../../src/domain/shared/calendar-date.js';
import { countCheckboxes, openSpecArchived, openSpecPlan } from '../../../src/integrations/flows/openspec/openspec-plan.js';
import { withHooks } from '../../../src/integrations/tools/claude-code/hook-settings.js';
import { SYNCHRONOUS_HOOK_EVENTS, CLAUDE_CODE_HOOK_EVENTS } from '../../../src/integrations/tools/claude-code/hook-events.js';
import { claudeCodeHooks } from '../../../src/integrations/tools/claude-code/hook-translation.js';
import { InMemoryProjectFiles } from '../../support/in-memory-files.js';

/** Synthetic payloads shaped like the ones Claude Code sends; every value is made up. */
const base = { session_id: 'sess-1', transcript_path: '/tmp/t.jsonl', cwd: '/work/api', permission_mode: 'auto', prompt_id: 'p-1' };
const translate = (event: string, extra: Record<string, unknown> = {}) => claudeCodeHooks.translate(event, { ...base, hook_event_name: event, ...extra });
const events = (event: string, extra: Record<string, unknown> = {}) => translate(event, extra).events;

describe('Claude Code hooks → activity events', () => {
  it('a user turn with its tools', () => {
    expect(translate('UserPromptSubmit', { prompt: 'fix the bug' })).toMatchObject({
      kind: 'prompt',
      cwd: '/work/api',
      events: [{ type: 'turn.started', data: { origin: 'user', turn: 'p-1' } }],
    });
    expect(events('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: { command: 'ls' } })).toEqual([
      { type: 'tool.started', data: { tool: 'Bash', toolUseId: 'tu-1' } },
    ]);
    expect(events('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', duration_ms: 1044, tool_response: { stdout: 'secret' } })).toEqual([
      { type: 'tool.used', data: { tool: 'Bash', toolUseId: 'tu-1', durationMs: 1044 } },
    ]);
    expect(events('Stop', { last_assistant_message: 'done' })).toEqual([{ type: 'turn.ended', data: { outcome: 'completed', turn: 'p-1' } }]);
  });

  it('never carries prompts, tool inputs or outputs into the events', () => {
    const all = [
      ...events('UserPromptSubmit', { prompt: 'my password is hunter2' }),
      ...events('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: { command: 'echo hunter2' } }),
      ...events('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', tool_response: { stdout: 'hunter2' } }),
      ...events('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'tu-1', error: 'hunter2 failed' }),
    ];
    expect(JSON.stringify(all)).not.toContain('hunter2');
  });

  it('a failed tool, and an interrupt that also ends the turn of the main agent', () => {
    expect(events('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'tu-2', duration_ms: 18, error: 'x', is_interrupt: false })).toEqual([
      { type: 'tool.used', data: { tool: 'Bash', toolUseId: 'tu-2', durationMs: 18, failed: true } },
    ]);
    expect(events('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'tu-3', is_interrupt: true }).map((e) => e.type)).toEqual(['tool.used', 'turn.ended']);
    expect(events('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'tu-4', is_interrupt: true, agent_id: 'a1' }).map((e) => e.type)).toEqual(['tool.used']);
  });

  it('a question to the user: a wait instead of a tool start, and no duplicate from the permission dialog', () => {
    expect(events('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'tu-5' })).toEqual([
      { type: 'turn.awaiting-input', data: { reason: 'question', turn: 'p-1' } },
    ]);
    expect(events('PermissionRequest', { tool_name: 'AskUserQuestion' })).toEqual([]);
    expect(events('Notification', { notification_type: 'permission_prompt', message: 'needs permission' })).toEqual([]);
    expect(events('PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'tu-5', duration_ms: 1 })).toEqual([
      { type: 'tool.used', data: { tool: 'AskUserQuestion', toolUseId: 'tu-5', durationMs: 1 } },
    ]);
  });

  it('a permission request for a command, and an MCP form asking the user', () => {
    expect(events('PermissionRequest', { tool_name: 'Bash' })).toEqual([{ type: 'turn.awaiting-input', data: { reason: 'permission', turn: 'p-1' } }]);
    expect(events('Notification', { notification_type: 'elicitation_dialog' })[0]).toMatchObject({ data: { reason: 'question' } });
    expect(events('Notification', { notification_type: 'idle_prompt' })).toEqual([]);
  });

  it('a background subagent: start, its tools with agent, the parent learns it runs in the background', () => {
    expect(events('SubagentStart', { agent_id: 'a1', agent_type: 'general-purpose' })).toEqual([
      { type: 'agent.started', data: { agent: 'a1', agentType: 'general-purpose' } },
    ]);
    expect(events('PreToolUse', { agent_id: 'a1', agent_type: 'general-purpose', tool_name: 'Bash', tool_use_id: 'tu-6' })).toEqual([
      { type: 'tool.started', data: { agent: 'a1', tool: 'Bash', toolUseId: 'tu-6' } },
    ]);
    for (const tool of ['Agent', 'Task']) {
      expect(
        events('PostToolUse', { tool_name: tool, tool_use_id: 'tu-7', duration_ms: 29, tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1' } }),
      ).toEqual([
        { type: 'tool.used', data: { tool, toolUseId: 'tu-7', durationMs: 29 } },
        { type: 'agent.detached', data: { agent: 'a1' } },
      ]);
    }
    expect(events('SubagentStop', { agent_id: 'a1', background_tasks: [] })).toEqual([{ type: 'agent.stopped', data: { agent: 'a1' } }]);
  });

  it('automated turns by their markup; pasted text is the user’s', () => {
    expect(events('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>x</task-id>' })[0]?.data).toMatchObject({ origin: 'automated' });
    expect(events('UserPromptSubmit', { prompt: '  <agent-message from="a1">done' })[0]?.data).toMatchObject({ origin: 'automated' });
    expect(events('UserPromptSubmit', { prompt: '<pasted_content id="1">log</pasted_content>' })[0]?.data).toMatchObject({ origin: 'user' });
  });

  it('session start and end; compaction, clear and subagent sessions are not new starts', () => {
    expect(translate('SessionStart', { source: 'startup' })).toMatchObject({ kind: 'session-start', events: [{ type: 'session.started', data: {} }] });
    expect(events('SessionStart', { source: 'resume' })).toEqual([{ type: 'session.started', data: { resumed: true } }]);
    expect(events('SessionStart', { source: 'compact' })).toEqual([]);
    expect(events('SessionStart', { source: 'clear' })).toEqual([]);
    expect(events('SessionStart', { source: 'startup', agent_id: 'a1' })).toEqual([]);
    expect(translate('SessionEnd', { reason: 'prompt_input_exit' })).toMatchObject({ kind: 'session-end', events: [{ type: 'session.ended' }] });
    expect(events('StopFailure', { error: 'rate_limit' })).toEqual([{ type: 'turn.ended', data: { outcome: 'error', turn: 'p-1' } }]);
  });

  it('refuses stdin without a session id or with an unsafe one, without repeating the value', () => {
    expect(() => claudeCodeHooks.translate('Stop', { cwd: '/x' })).toThrow(/session_id is missing/);
    expect(() => claudeCodeHooks.translate('Stop', [])).toThrow(InvalidValue);
    expect(() => claudeCodeHooks.translate('Stop', { session_id: '../../etc' })).toThrow(/invalid session id/);
  });

  it('renders context in the hookSpecificOutput format', () => {
    expect(JSON.parse(claudeCodeHooks.renderContext('SessionStart', 'hello'))).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hello' },
    });
  });
});

describe('installed hooks are asynchronous except those the agent waits for', () => {
  it('marks every hook async but SessionStart, UserPromptSubmit and SessionEnd, and upgrades old ones', () => {
    const command = (event: string) => `estimetry hook claude-code ${event}`;
    const old = withHooks(undefined, { events: CLAUDE_CODE_HOOK_EVENTS, synchronous: CLAUDE_CODE_HOOK_EVENTS, command }, 'settings.json');
    expect(old).not.toContain('"async"');
    const settings = JSON.parse(withHooks(old, { events: CLAUDE_CODE_HOOK_EVENTS, synchronous: SYNCHRONOUS_HOOK_EVENTS, command }, 'settings.json')) as {
      hooks: Record<string, { hooks: { async?: boolean }[] }[]>;
    };
    const asyncEvents = Object.entries(settings.hooks).filter(([, groups]) => groups[0]?.hooks[0]?.async === true).map(([event]) => event);
    expect(asyncEvents).toHaveLength(9);
    expect(asyncEvents).not.toContain('SessionStart');
    expect(asyncEvents).not.toContain('UserPromptSubmit');
    expect(asyncEvents).not.toContain('SessionEnd');
    expect(Object.values(settings.hooks).every((groups) => groups.length === 1)).toBe(true);
  });
});

describe('OpenSpec plan', () => {
  it('counts checkboxes outside code blocks, with any marker and case', () => {
    expect(countCheckboxes('- [x] a\n  - [ ] b\n* [X] c\n```\n- [ ] example\n```\n- not a box\n')).toEqual({ done: 2, total: 3 });
  });

  it('reads active and archived changes, an active one wins, an unreadable tasks.md counts as none', () => {
    const root = '/p';
    const files = new InMemoryProjectFiles({
      '/p/openspec/changes/hooks-and-flows/tasks.md': '- [x] a\n- [ ] b\n',
      '/p/openspec/changes/archive/2026-10-30-claude-code-init/tasks.md': '- [x] a\n- [x] b\n',
      '/p/openspec/changes/archive/2026-10-01-hooks-and-flows/tasks.md': '- [x] old\n',
      '/p/openspec/changes/archive/not-a-date/tasks.md': '- [x] x\n',
    });
    expect(openSpecPlan(root, files)).toEqual([
      { change: 'claude-code-init', archived: true, archivedOn: '2026-10-30', done: 2, total: 2 },
      { change: 'hooks-and-flows', archived: false, done: 1, total: 2 },
    ]);
    const broken = new InMemoryProjectFiles({ '/p/openspec/changes/x/tasks.md': '- [x] a\n' });
    broken.read = () => {
      throw new Error('EACCES');
    };
    expect(openSpecPlan(root, broken)).toEqual([{ change: 'x', archived: false, done: 0, total: 0 }]);
  });

  it('takes the latest of duplicate archives and keeps active changes without tasks.md', () => {
    const files = new InMemoryProjectFiles({
      '/p/openspec/changes/new-one/proposal.md': '# new\n',
      '/p/openspec/changes/archive/2026-10-27-auth/tasks.md': '- [ ] a\n',
      '/p/openspec/changes/archive/2026-10-30-auth/tasks.md': '- [x] a\n- [x] b\n',
    });
    expect(openSpecPlan('/p', files)).toEqual([
      { change: 'auth', archived: true, archivedOn: '2026-10-30', done: 2, total: 2 },
      { change: 'new-one', archived: false, done: 0, total: 0 },
    ]);
  });

  it('does not read tasks of archives before the cut-off, keeping their name and date', () => {
    const files = new InMemoryProjectFiles({
      '/p/openspec/changes/archive/2026-09-01-old/tasks.md': '- [x] a\n',
      '/p/openspec/changes/archive/2026-10-30-new/tasks.md': '- [x] a\n',
    });
    const read: string[] = [];
    const original = files.read.bind(files);
    files.read = (path) => (read.push(path), original(path));
    expect(openSpecPlan('/p', files, { archivedSince: CalendarDate.parse('2026-10-25') })).toEqual([
      { change: 'new', archived: true, archivedOn: '2026-10-30', done: 1, total: 1 },
      { change: 'old', archived: true, archivedOn: '2026-09-01', done: 0, total: 0 },
    ]);
    expect(read).toEqual(['/p/openspec/changes/archive/2026-10-30-new/tasks.md']);
  });

  it('lists the archive without reading tasks, skipping names without a real date; no archive is empty', () => {
    const files = new InMemoryProjectFiles({
      '/p/openspec/changes/archive/2026-11-02-plan-progress/tasks.md': '- [x] a\n',
      '/p/openspec/changes/archive/2026-02-30-bad/tasks.md': '- [x] a\n',
      '/p/openspec/changes/archive/notes/x.md': '',
    });
    files.read = () => {
      throw new Error('must not read');
    };
    expect(openSpecArchived('/p', files).map((c) => ({ ...c, archivedOn: c.archivedOn.value }))).toEqual([
      {
        change: 'plan-progress',
        archivedOn: '2026-11-02',
        directory: '2026-11-02-plan-progress',
        path: '/p/openspec/changes/archive/2026-11-02-plan-progress',
      },
    ]);
    expect(openSpecArchived('/q', new InMemoryProjectFiles())).toEqual([]);
  });
});
