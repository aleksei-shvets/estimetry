export const BLOCK_START = '<!-- estimetry:start -->';
export const BLOCK_END = '<!-- estimetry:end -->';

const EXISTING = new RegExp(`\\n*${escape(BLOCK_START)}[\\s\\S]*?${escape(BLOCK_END)}\\n?`);

/**
 * A markdown file of instructions for the agent (`CLAUDE.md`, `AGENTS.md`) with one estimetry block at the end:
 * the markers around `## estimetry` and `body`. Text outside the markers stays.
 */
export function withBlock(text: string | undefined, body: string): string {
  const block = [BLOCK_START, '## estimetry', '', body, BLOCK_END].join('\n');
  const rest = withoutBlock(text ?? '');
  return rest === '' ? `${block}\n` : `${rest.replace(/\n*$/, '')}\n\n${block}\n`;
}

/** The file without the block; the text is returned as is when there is none. */
export function withoutBlock(text: string): string {
  if (!EXISTING.test(text)) {
    return text;
  }
  const rest = text.replace(EXISTING, '\n');
  return rest.trim() === '' ? '' : `${rest.replace(/\n+$/, '')}\n`;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
