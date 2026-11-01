/** Hook events of Claude Code that the activity contract needs (design.md of claude-code-init and hooks-and-flows). */
export const CLAUDE_CODE_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Notification',
  'PermissionRequest',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
] as const;

/** Hooks the agent must wait for: their context has to reach it in the same turn, or the session is ending. */
export const SYNCHRONOUS_HOOK_EVENTS: readonly string[] = ['SessionStart', 'UserPromptSubmit', 'SessionEnd'];
