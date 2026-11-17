import type { ActivityEvent } from '../../domain/measurement/activity-events.js';
import type { SessionId } from '../../domain/measurement/session-id.js';

/** What a call is for the core: whether it may write a checkpoint, and which context it can return. */
export type HookKind = 'session-start' | 'session-end' | 'prompt' | 'tool-done' | 'turn-end' | 'other';

/** The draft of one kind of activity event: its data without `source` and `session`, which the core adds. */
type DraftOf<E extends ActivityEvent> = E extends ActivityEvent
  ? { readonly type: E['type']; readonly data: Omit<E['data'], 'source' | 'session'> }
  : never;

/** An activity event without its envelope and without `source` and `session`; the compiler checks its data by its type. */
export type ActivityDraft = DraftOf<ActivityEvent>;

export interface HookTranslation {
  readonly session: SessionId;
  /** Working directory of the tool, when the payload names one. */
  readonly cwd?: string;
  readonly kind: HookKind;
  readonly events: readonly ActivityDraft[];
  /** Path of the session log, when the tool reports one; a path on this machine, not a text. */
  readonly transcript?: string;
}

/**
 * Translates the hooks of one AI tool into activity events. Kept apart from
 * ToolAdapter (installation): the hook receiver runs on every tool call and
 * loads only this.
 */
export interface HookAdapter {
  readonly kind: 'session';
  readonly id: string;
  readonly aliases: readonly string[];
  readonly hookEvents: readonly string[];
  /**
   * The environment variable in which the tool names the project root of a hook (`CLAUDE_PROJECT_DIR`); omitted when
   * the tool has none and the `cwd` of the payload decides. Another tool's variable is never read.
   */
  readonly projectDirVariable?: string;
  /** How long the session end hook may import the log: the tool waits for it only so long. */
  readonly sessionEndBudgetMs: number;
  /** @throws InvalidValue if the payload is not what the tool sends. Prompt and tool texts never leave this call. */
  translate(event: string, payload: unknown): HookTranslation;
  /** How the agent of this tool calls a skill of estimetry: `/emt-extra`, `$emt-extra`. */
  skillRef(id: string): string;
  /** The text for the agent in the tool's own output format; its skills are already named by `skillRef`. */
  renderContext(event: string, text: string): string;
}

/** The commit a hook call names: its sha, or `HEAD` when the call names none. */
export interface CommitNotice {
  readonly sha?: string;
}

/**
 * A source of commits (the git `post-commit` hook): it names the commit of a
 * call, the core reads the commit and records it for the task.
 */
export interface CommitHookAdapter {
  readonly kind: 'commit';
  readonly id: string;
  readonly aliases: readonly string[];
  readonly hookEvents: readonly string[];
  /** Never throws: a payload that names no commit means `HEAD`. */
  commitOf(event: string, payload: string): CommitNotice;
}

/** Whatever `estimetry hook <source>` may name; the receiver tells them apart by `kind`, never by name. */
export type HookSource = HookAdapter | CommitHookAdapter;

export interface HookAdapters {
  get(idOrAlias: string): HookSource | undefined;
}
