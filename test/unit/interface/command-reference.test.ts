import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProgram, type CliOptions } from '../../../src/interface/cli/program.js';
import { commandReference, referenceBlock, referenceShape, withReference } from '../../support/command-reference.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const README = join(ROOT, 'README.md');
const README_RU = join(ROOT, 'README.ru.md');

function program() {
  const fail = () => {
    throw new Error('the reference must not touch the application');
  };
  const options = {
    name: 'emt',
    version: '0.0.0',
    app: fail,
    hooks: fail,
    out: { print: () => undefined, error: () => undefined },
    terminal: { interactive: false, input: process.stdin, output: process.stdout },
    errors: { report: () => undefined },
  } as unknown as CliOptions;
  return createProgram(options);
}

describe('the command reference of the README', () => {
  const reference = commandReference(program());

  it('in README.md is generated from the CLI: a new command or flag fails until `npm run docs:commands`', () => {
    const readme = readFileSync(README, 'utf8');
    if (process.env['UPDATE_COMMAND_REFERENCE'] === '1') {
      writeFileSync(README, withReference(readme, reference));
      return;
    }
    expect(referenceBlock(readme), 'README.md: run `npm run docs:commands`').toBe(reference);
  });

  it('in README.ru.md has the same stages, commands and flags in the same order', () => {
    const block = referenceBlock(readFileSync(README_RU, 'utf8'));
    expect(block, 'README.ru.md has no command reference markers').toBeDefined();
    expect(referenceShape(block ?? '')).toEqual(referenceShape(reference));
  });

  it('lists every command of `emt --help` with its flags, required ones marked', () => {
    expect(reference).toContain('- **`emt task new <title>`** — create a task in the current project');
    expect(reference).toContain('  - `--lesson <text>` — one lesson for the next estimate (required)');
    expect(reference).not.toContain('emt hook');
  });
});
