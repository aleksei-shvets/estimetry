import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { InitInput, InitReport } from '../../../src/application/project/init-project.js';
import type { InitChoices } from '../../../src/application/project/show-init-choices.js';
import { createProgram, type CliOptions } from '../../../src/interface/cli/program.js';

const CHOICES: InitChoices = {
  projectRoot: '/work/app',
  tools: [
    { id: 'claude-code', title: 'Claude Code', asksTrust: false },
    { id: 'codex', title: 'Codex', asksTrust: true },
  ],
  flows: [{ id: 'none', title: 'No SDD' }],
  defaults: { tools: ['claude-code'], flow: 'none', share: 'none', shared: false, trackCommits: false },
  unignoredPersonalFiles: [],
};
const REPORT: InitReport = { project: 'app', flow: 'none', tools: [], stack: [], share: 'none', files: [], warnings: [] };

/** `estimetry init` in a terminal with these answers, against an application that only records its input. */
async function initInTerminal(args: readonly string[], ...answers: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let asked = '';
  output.on('data', (chunk: Buffer) => (asked += chunk.toString()));
  input.end(answers.map((answer) => `${answer}\n`).join(''));
  let received: InitInput | undefined;
  const app = { project: { choices: () => CHOICES, init: (given: InitInput) => ((received = given), REPORT) } };
  const options = {
    name: 'estimetry',
    version: '1.0.0',
    app: async () => app,
    hooks: async () => ({ receive: async () => undefined }),
    out: { print: () => undefined, error: () => undefined },
    terminal: { interactive: true, input, output },
    errors: { report: () => undefined },
    cwd: '/work/app',
  } as unknown as CliOptions;
  await createProgram(options).parseAsync(['init', ...args], { from: 'user' });
  return { received, asked };
}

describe('the question of init about trusting the hooks', () => {
  it('is asked when Codex is chosen, and yes is the default', async () => {
    const { received, asked } = await initInTerminal(['--tools', 'codex', '--flow', 'none', '--share', 'none', '--no-track-commits'], '');
    expect(asked).toMatch(/Codex runs a hook only after you trust it.*\[Y\/n\]/s);
    expect(received?.trustHooks).toBe(true);
  });

  it('takes no for an answer', async () => {
    const { received } = await initInTerminal(['--tools', 'codex', '--flow', 'none', '--share', 'none', '--no-track-commits'], 'n');
    expect(received?.trustHooks).toBe(false);
  });

  it('is not asked for a tool that runs hooks without a trust, nor when a flag answered it', async () => {
    const claude = await initInTerminal(['--tools', 'claude-code', '--flow', 'none', '--share', 'none', '--no-track-commits']);
    expect(claude.asked).not.toContain('trust');
    expect(claude.received).not.toHaveProperty('trustHooks');
    const flagged = await initInTerminal(['--tools', 'codex', '--flow', 'none', '--share', 'none', '--no-track-commits', '--no-trust-hooks']);
    expect(flagged.asked).not.toContain('trust');
    expect(flagged.received?.trustHooks).toBe(false);
  });
});
