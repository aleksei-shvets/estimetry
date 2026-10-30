import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Prompts } from '../../../src/interface/cli/prompts.js';

function session(...answers: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = '';
  output.on('data', (chunk: Buffer) => (printed += chunk.toString()));
  input.end(answers.map((answer) => `${answer}\n`).join(''));
  return { prompts: new Prompts(input, output), printed: () => printed };
}

const TOOLS = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex', disabled: true },
  { value: 'cursor', label: 'Cursor', disabled: true },
] as const;

describe('Prompts', () => {
  it('lists unavailable options without a number and takes the default on Enter', async () => {
    const { prompts, printed } = session('');
    expect(await prompts.multiSelect('AI tools', TOOLS, ['claude-code'])).toEqual(['claude-code']);
    expect(printed()).toContain('  1) Claude Code\n     Codex (coming soon)\n     Cursor (coming soon)\n');
  });

  it('selects by number and repeats the question on a wrong answer', async () => {
    const { prompts, printed } = session('7', 'x', '2');
    const flows = [
      { value: 'openspec', label: 'OpenSpec' },
      { value: 'none', label: 'No SDD', hint: 'plan = parts of the estimate' },
    ] as const;
    expect(await prompts.select('Development process', flows, 'openspec')).toBe('none');
    expect(printed().match(/Enter a number from 1 to 2/g)).toHaveLength(2);
    expect(printed()).toContain('2) No SDD — plan = parts of the estimate');
  });

  it('confirms with y/n, Enter keeps the default, and the end of input answers with defaults', async () => {
    const { prompts } = session('maybe', 'y', '');
    expect(await prompts.confirm('Install the git hook?', false)).toBe(true);
    expect(await prompts.confirm('Exclude it?', true)).toBe(true);
    expect(await prompts.confirm('Anything else?', false)).toBe(false);
    prompts.close();
  });

  it('accepts several numbers', async () => {
    const { prompts } = session('2, 1');
    expect(await prompts.multiSelect('Pick', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], ['a'])).toEqual(['b', 'a']);
  });
});
