import { describe, expect, it } from 'vitest';
import { skillMention } from '../../../src/application/contracts/skill-mention.js';
import { cut } from '../../../src/application/hooks/context-limit.js';

describe('a text for the agent cut to the limit', () => {
  it('keeps a short text as it is and cuts a long one with an ellipsis', () => {
    expect(cut('short', 10)).toBe('short');
    expect(cut('a'.repeat(20), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('never cuts a mention of a skill in two: the agent would get a piece of the mark', () => {
    const text = `${'a'.repeat(20)} run ${skillMention('emt-extra')} now`;
    const short = cut(text, 30);
    expect(short).not.toContain('{{');
    expect(short.length).toBeLessThanOrEqual(30);
    expect(short.endsWith('…')).toBe(true);
  });
});
