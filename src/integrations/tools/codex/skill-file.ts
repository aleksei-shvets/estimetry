import type { CommandContent } from '../../../application/contracts/command-content.js';
import { ARGUMENTS_MENTION, renderBody } from '../../../application/contracts/skill-mention.js';
import { generatedBy, stamp } from '../shared/generated-file.js';
import { codexSkillRef } from './hook-events.js';

/** Codex has no substitution of arguments: the agent finds them in the message that called the skill. */
const ARGUMENTS = '<arguments>';

/** A skill file in the format of Codex (`name`, `description`), stamped with the version and a hash of its own text. */
export function renderSkill(content: CommandContent, version: string): string {
  const takesArguments = content.body.includes(ARGUMENTS_MENTION);
  return stamp(
    [
      '---',
      `name: ${content.id}`,
      `description: ${JSON.stringify(content.description)}`,
      ...generatedBy(version),
      '---',
      '',
      ...(takesArguments
        ? [`\`${ARGUMENTS}\` below stands for what the user wrote after \`${codexSkillRef(content.id)}\`, if anything.`, '']
        : []),
      renderBody(content.body, codexSkillRef, ARGUMENTS),
    ].join('\n'),
  );
}
