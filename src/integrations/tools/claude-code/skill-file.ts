import type { CommandContent } from '../../../application/contracts/command-content.js';
import { renderBody } from '../../../application/contracts/skill-mention.js';
import { generatedBy, stamp } from '../shared/generated-file.js';
import { claudeCodeSkillRef } from './hook-events.js';

const ALLOWED_TOOLS = 'Bash(emt *) Bash(estimetry *)';

/** A skill file in Claude Code's format, stamped with the version and a hash of its own text. */
export function renderSkill(content: CommandContent, version: string): string {
  return stamp(
    [
      '---',
      `name: ${content.id}`,
      `description: ${JSON.stringify(content.description)}`,
      ...(content.argumentHint === undefined ? [] : [`argument-hint: ${JSON.stringify(content.argumentHint)}`]),
      `allowed-tools: ${ALLOWED_TOOLS}`,
      ...generatedBy(version),
      '---',
      '',
      renderBody(content.body, claudeCodeSkillRef, '$ARGUMENTS'),
    ].join('\n'),
  );
}
