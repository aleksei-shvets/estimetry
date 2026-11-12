import { Help, type Command, type Option } from 'commander';
import { argumentsOf, groupOf, HELP_GROUPS, leaves, optionDescription, OTHER_GROUP, shownOptions } from '../../src/interface/cli/help.js';

/** The markers of the generated block in README.md. */
export const START = '<!-- commands:start: generated from the CLI by `npm run docs:commands` -->';
export const END = '<!-- commands:end -->';

/**
 * The command reference of the README in Markdown, from the same walk as
 * `emt --help`: every command by stage, with its arguments and options.
 */
export function commandReference(program: Command): string {
  const helper = new Help();
  const name = program.name();
  const optionText = (option: Option) => optionDescription(helper, option);
  const out: string[] = [];
  for (const group of [...HELP_GROUPS, OTHER_GROUP]) {
    const members = leaves(program).filter((leaf) => groupOf(leaf.command) === group);
    if (members.length === 0) {
      continue;
    }
    out.push(`### ${group}`, '');
    for (const leaf of members) {
      const term = [name, leaf.path, argumentsOf(leaf.command)].filter((part) => part !== '').join(' ');
      out.push(`- **\`${term}\`** — ${helper.commandDescription(leaf.command)}`);
      out.push(...shownOptions(leaf.command).map((option) => `  - \`${option.flags}\` — ${optionText(option)}`));
    }
    out.push('');
  }
  out.push('### General options', '');
  out.push(...helper.visibleOptions(program).map((option) => `- \`${option.flags}\` — ${optionText(option)}`));
  out.push('- `--json` — print JSON; most commands have it');
  return out.join('\n');
}

/** The text between the markers; undefined without them. */
export function referenceBlock(readme: string): string | undefined {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  return start < 0 || end < start ? undefined : readme.slice(start + START.length, end).trim();
}

/** The README with the block between the markers replaced. */
export function withReference(readme: string, reference: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error('README has no command reference markers');
  }
  return `${readme.slice(0, start + START.length)}\n\n${reference}\n\n${readme.slice(end)}`;
}

/**
 * The structure a translation keeps: stage headings in order, then each
 * command and flag as the code span that starts its line.
 */
export function referenceShape(block: string): string[] {
  return block.split('\n').flatMap((line) => {
    if (line.startsWith('### ')) {
      return ['###'];
    }
    const code = /^\s*- (?:\*\*)?`([^`]+)`/.exec(line);
    return code?.[1] === undefined ? [] : [`${line.startsWith('  ') ? '  ' : ''}${code[1]}`];
  });
}
