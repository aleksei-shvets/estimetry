import { createHash } from 'node:crypto';
import type { CommandContent } from '../../../application/contracts/command-content.js';

const ALLOWED_TOOLS = 'Bash(emt *) Bash(estimetry *)';
const HASH_LINE = /^ {2}contentHash: "[0-9a-f]*"\n/m;

/** A skill file in Claude Code's format, stamped with the version and a hash of its own text. */
export function renderSkill(content: CommandContent, version: string): string {
  const unhashed = [
    '---',
    `name: ${content.id}`,
    `description: ${JSON.stringify(content.description)}`,
    ...(content.argumentHint === undefined ? [] : [`argument-hint: ${JSON.stringify(content.argumentHint)}`]),
    `allowed-tools: ${ALLOWED_TOOLS}`,
    'metadata:',
    `  generatedBy: "estimetry ${version}"`,
    '---',
    '',
    content.body,
  ].join('\n');
  return unhashed.replace(/^ {2}generatedBy: .*\n/m, (line) => `${line}  contentHash: "${hashOf(unhashed)}"\n`);
}

export type Ownership = 'ours' | 'edited' | 'foreign';

/** Whose the file is: ours and untouched, ours but edited by the user, or the user's own. */
export function ownership(text: string): Ownership {
  if (!/^ {2}generatedBy: "estimetry /m.test(text)) {
    return 'foreign';
  }
  const stamped = /^ {2}contentHash: "([0-9a-f]*)"$/m.exec(text)?.[1];
  return stamped !== undefined && stamped === hashOf(text.replace(HASH_LINE, '')) ? 'ours' : 'edited';
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}
