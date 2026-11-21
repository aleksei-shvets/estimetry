import { EMPTY_PLAN, type InstallPlan } from '../../../application/ports/file-change.js';

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

/**
 * The block in an instructions file: written with a shared install (the file the team commits), taken out with a
 * personal one; a file left with nothing but the block goes.
 */
export function instructionsPlan(path: string, current: string | undefined, shared: boolean, body: string): InstallPlan {
  if (shared) {
    return { changes: [{ path, content: withBlock(current, body) }], skipped: [], warnings: [] };
  }
  const rest = current === undefined ? current : withoutBlock(current);
  if (rest === undefined || rest === current) {
    return EMPTY_PLAN;
  }
  return { changes: [rest === '' ? { path, remove: true } : { path, content: rest }], skipped: [], warnings: [] };
}
