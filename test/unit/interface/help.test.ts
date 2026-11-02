import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, groupOf, leaves, OTHER_GROUP, shownOptions } from '../../../src/interface/cli/help.js';
import { createProgram, type CliOptions } from '../../../src/interface/cli/program.js';

function program(name = 'emt'): Command {
  const fail = () => {
    throw new Error('help must not touch the application');
  };
  const options = {
    name,
    version: '1.2.3',
    app: fail,
    hooks: fail,
    out: { print: () => undefined, error: () => undefined },
    terminal: { interactive: false, input: process.stdin, output: process.stdout },
    errors: { report: () => undefined },
  } as unknown as CliOptions;
  return createProgram(options, { helpWidth: 100 });
}

/** The block of one command in the overview: its line and the option lines under it, up to the next command or group. */
function block(help: string, path: string): string {
  const lines = help.split('\n');
  const isCommand = (line: string) => /^ {2}\S/.test(line);
  const start = lines.findIndex((line) => isCommand(line) && (line.slice(2) === path || line.slice(2).startsWith(`${path} `)));
  expect(start, `no block for "${path}"`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, i) => i > start && (isCommand(line) || line === '' || !line.startsWith(' ')));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

const hasFlag = (text: string, flag: string) => new RegExp(`(^|[\\s,])${flag.replace(/[-]/g, '\\-')}(?![\\w-])`, 'm').test(text);

describe('help of the root', () => {
  const root = program();
  const help = root.helpInformation();

  it('lists every command with every option of its own, by stage, and leaves nothing in Other', () => {
    const all = leaves(root);
    expect(all.map((leaf) => leaf.path)).toEqual(expect.arrayContaining(['task new', 'estimate save', 'parallel on', 'close', 'retro']));
    for (const leaf of all) {
      expect(groupOf(leaf.command), `${leaf.path} has no help group`).not.toBe(OTHER_GROUP);
      const own = block(help, leaf.path);
      for (const option of leaf.command.options.filter((o) => o.long !== '--help')) {
        const shown = shownOptions(leaf.command).includes(option);
        if (shown) {
          expect(hasFlag(own, option.long as string), `${leaf.path} ${option.long}`).toBe(true);
        }
      }
    }
    expect(help).not.toContain(`${OTHER_GROUP}:`);
    for (const group of ['Setup:', 'Tasks and estimates:', 'Measuring:', 'Closing:']) {
      expect(help).toContain(group);
    }
  });

  it('marks required options and says what --json does once, keeping a description of its own', () => {
    expect(block(help, 'retro')).toMatch(/--lesson <text>\s+one lesson for the next estimate \(required\)/);
    expect(hasFlag(block(help, 'init'), '--track-commits')).toBe(true);
    expect(help).toContain('Most commands print JSON with --json.');
    expect(block(help, 'close')).not.toContain('--json');
    expect(block(help, 'status')).toContain('--json');
    expect(help).toMatch(/-v, --version/);
    expect(help).not.toMatch(/^ {2}help\b/m);
  });

  it('every example names commands and options that exist', () => {
    const paths = new Map(leaves(root).map((leaf) => [leaf.path, leaf.command]));
    for (const example of EXAMPLES) {
      for (const part of example.split(' && ')) {
        const words = part.split(' ');
        const path = [2, 1].map((n) => words.slice(0, n).join(' ')).find((candidate) => paths.has(candidate));
        expect(path, `no command in "${part}"`).toBeDefined();
        const command = paths.get(path as string) as Command;
        for (const flag of words.filter((word) => word.startsWith('--'))) {
          expect(command.options.some((option) => option.long === flag), `${path} ${flag}`).toBe(true);
        }
      }
    }
    expect(help).toContain('emt task new "Payments" && emt estimate save plan.yaml');
    expect(program('estimetry').helpInformation()).toContain('estimetry close && estimetry retro');
  });
});

describe('help of a group', () => {
  it('lists its commands with their options', () => {
    const task = program().commands.find((command) => command.name() === 'task') as Command;
    const help = task.helpInformation();
    expect(help).toMatch(/task new <title>[\s\S]*--ticket <key>/);
    expect(help).toMatch(/task list[\s\S]*--closed/);
    expect(help).toContain('task show <task>');
  });
});
