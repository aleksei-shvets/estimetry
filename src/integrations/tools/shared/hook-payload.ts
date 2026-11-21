import type { ActivityDraft, HookKind, HookTranslation } from '../../../application/contracts/hook-adapter.js';
import { SessionId } from '../../../domain/measurement/session-id.js';
import { InvalidValue } from '../../../domain/shared/domain-error.js';

/*
 * What the hooks of Claude Code and Codex share: the same envelope on stdin (`session_id`, `cwd`, `transcript_path`)
 * and the same output of context. One rule for both, so they never differ in what an absent value is. Kept small: the
 * hook receiver loads it on every tool call.
 */

export type HookPayload = Readonly<Record<string, unknown>>;

/**
 * The translation of one call: the envelope checked here, the events by the tool's own rules. An empty string is
 * no value. @throws InvalidValue naming the tool and the event, never the content of the payload.
 */
export function translateHook(
  tool: string,
  event: string,
  payload: unknown,
  kinds: Readonly<Record<string, HookKind>>,
  events: (event: string, payload: HookPayload) => ActivityDraft[],
): HookTranslation {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidValue(`${tool} ${event}: stdin is not a JSON object`);
  }
  const p = payload as HookPayload;
  if (typeof p['session_id'] !== 'string') {
    throw new InvalidValue(`${tool} ${event}: session_id is missing`);
  }
  const cwd = payloadText(p['cwd']);
  const transcript = payloadText(p['transcript_path']);
  return {
    session: SessionId.parse(p['session_id']),
    ...(cwd === undefined ? {} : { cwd }),
    ...(transcript === undefined ? {} : { transcript }),
    kind: kinds[event] ?? 'other',
    events: events(event, p),
  };
}

/** A string field of a payload; an empty one, or anything else, is no value. */
export function payloadText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Context for the agent in the output both tools read: `hookSpecificOutput.additionalContext`. */
export function additionalContext(event: string, text: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}
