/** The agent reads this; the tool shows it among system messages, so it stays short. */
export const MAX_CONTEXT_LENGTH = 1000;

/** Text for the agent cut to the limit, with an ellipsis when it was longer. */
export function cut(text: string, limit = MAX_CONTEXT_LENGTH): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}
