import type { ActivityEventType } from '../../domain/measurement/activity-events.js';
import type { SessionId } from '../../domain/measurement/session-id.js';

/** What a call is for the core: whether it may write a checkpoint, and which context it can return. */
export type HookKind = 'session-start' | 'session-end' | 'prompt' | 'tool-done' | 'turn-end' | 'other';

/** An activity event without its envelope and without `source` and `session`, which the core adds. */
export interface ActivityDraft {
  readonly type: ActivityEventType;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface HookTranslation {
  readonly session: SessionId;
  /** Working directory of the tool, when the payload names one. */
  readonly cwd?: string;
  readonly kind: HookKind;
  readonly events: readonly ActivityDraft[];
}

/**
 * Translates the hooks of one AI tool into activity events. Kept apart from
 * ToolAdapter (installation): the hook receiver runs on every tool call and
 * loads only this.
 */
export interface HookAdapter {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly hookEvents: readonly string[];
  /** @throws InvalidValue if the payload is not what the tool sends. Prompt and tool texts never leave this call. */
  translate(event: string, payload: unknown): HookTranslation;
  /** The text for the agent in the tool's own output format. */
  renderContext(event: string, text: string): string;
}

export interface HookAdapters {
  get(idOrAlias: string): HookAdapter | undefined;
}
