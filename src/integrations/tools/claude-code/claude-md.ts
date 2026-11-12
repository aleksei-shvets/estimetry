export const BLOCK_START = '<!-- estimetry:start -->';
export const BLOCK_END = '<!-- estimetry:end -->';

const BLOCK = [
  BLOCK_START,
  '## estimetry',
  '',
  'Before you name a deadline or an effort for a task, run `/emt-estimate`: ' +
    'it bases the estimate on past tasks and saves it as the plan the actual effort is measured against.',
  BLOCK_END,
].join('\n');

const EXISTING = new RegExp(`\\n*${escape(BLOCK_START)}[\\s\\S]*?${escape(BLOCK_END)}\\n?`);

/** `CLAUDE.md` with one estimetry block at the end; text outside the markers stays. */
export function withBlock(text: string | undefined): string {
  const rest = withoutBlock(text ?? '') ?? '';
  return rest === '' ? `${BLOCK}\n` : `${rest.replace(/\n*$/, '')}\n\n${BLOCK}\n`;
}

/** `CLAUDE.md` without the block; the text is returned as is when there is none. */
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
