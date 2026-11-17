import { describe, expect, it } from 'vitest';
import { ARGUMENTS_MENTION, nameSkills, renderBody, skillMention } from '../../../src/application/contracts/skill-mention.js';

describe('a skill mentioned before the tool is known', () => {
  it('becomes the way each tool calls skills', () => {
    const text = `run ${skillMention('emt-estimate')}, then ${skillMention('emt-start')}`;
    expect(nameSkills(text, (id) => `/${id}`)).toBe('run /emt-estimate, then /emt-start');
    expect(nameSkills(text, (id) => `$${id}`)).toBe('run $emt-estimate, then $emt-start');
  });

  it('is never shorter than the name it becomes, so a text cut to a limit stays within it', () => {
    for (const id of ['emt-extra', 'emt-estimate', 'emt-start', 'emt-close']) {
      expect(skillMention(id).length).toBeGreaterThan(`$${id}`.length);
    }
  });

  it('a body takes the arguments in the tool form, every time they appear', () => {
    const body = `emt status ${ARGUMENTS_MENTION}; emt close ${ARGUMENTS_MENTION} --yes; then ${skillMention('emt-retro')}`;
    expect(renderBody(body, (id) => `/${id}`, '$ARGUMENTS')).toBe('emt status $ARGUMENTS; emt close $ARGUMENTS --yes; then /emt-retro');
  });
});
