/** The agent reads this; the tool shows it among system messages, so it stays short. */
export const MAX_CONTEXT_LENGTH = 1000;

/**
 * Text for the agent cut to the limit, with an ellipsis when it was longer. A mention of a skill (`{{skill:…}}`) is
 * named only after the cut, so a cut inside one drops the whole mark rather than leave a piece of it to the agent.
 */
export function cut(text: string, limit = MAX_CONTEXT_LENGTH): string {
  if (text.length <= limit) {
    return text;
  }
  const head = text.slice(0, Math.max(0, limit - 1));
  const open = head.lastIndexOf('{{');
  return `${open > head.lastIndexOf('}}') ? head.slice(0, open) : head}…`;
}
