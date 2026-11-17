/** Hook events of Codex that the activity contract needs (design.md of codex-adapter, D3 and D5). */
export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'Interrupt',
  'PermissionRequest',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
] as const;

/** Hooks Codex runs synchronously: their context reaches the agent in the same turn, and `SessionEnd` is always synchronous. */
export const CODEX_SYNCHRONOUS_EVENTS: readonly string[] = ['SessionStart', 'UserPromptSubmit', 'SessionEnd'];

/** Codex waits for `SessionEnd` and `Interrupt` at most 3 seconds; other hooks get the timeout of estimetry. */
export const CODEX_SHORT_TIMEOUT_EVENTS: readonly string[] = ['SessionEnd', 'Interrupt'];
export const CODEX_SHORT_TIMEOUT_SECONDS = 3;

/** How Codex calls a skill: `$name`. One rule for the context of hooks and the bodies of skills. */
export function codexSkillRef(id: string): string {
  return `$${id}`;
}
