import { Help, type Command, type Option } from 'commander';

/** Stages of the work, in the order help lists them; a command without one falls into `Other`. */
export const HELP_GROUPS = ['Setup', 'Tasks and estimates', 'Measuring', 'Closing'] as const;
export type HelpGroup = (typeof HELP_GROUPS)[number];
export const OTHER_GROUP = 'Other';

/** A term longer than this puts its description on the next line instead of pushing the column right. */
const MAX_TERM_COLUMN = 40;

/** The description `--json` has on most commands; help says it once instead of on every command. */
export const JSON_DESCRIPTION = 'print JSON';

/**
 * Typical order of work, one line each; `&&` separates commands. A test
 * parses every line, so an example cannot name a command or option that does not exist.
 */
export const EXAMPLES: readonly string[] = [
  'init --track-commits',
  'task new "Payments" && similar --type feature --hours 8 && calibrate --type feature',
  'estimate save plan.yaml',
  'start',
  'status',
  'close && retro --reason "<why>" --lesson "<one lesson>"',
];

/** A command that runs (has no subcommands), with its path from the root, e.g. `task new`. */
export interface Leaf {
  readonly command: Command;
  readonly path: string;
}

/** Commands the user can type: the implicit `help` and hidden ones are left out. */
function subcommands(command: Command): Command[] {
  return command.commands.filter((sub) => !(sub as unknown as { _hidden?: boolean })._hidden);
}

export function leaves(command: Command, prefix = ''): Leaf[] {
  return subcommands(command).flatMap((sub) => {
    const path = prefix === '' ? sub.name() : `${prefix} ${sub.name()}`;
    return subcommands(sub).length === 0 ? [{ command: sub, path }] : leaves(sub, path);
  });
}

/** The group of a command: its own, else the one of its parent. */
export function groupOf(command: Command): string {
  for (let current: Command | null = command; current !== null; current = current.parent) {
    const group = current.helpGroup();
    if (group !== '') {
      return group;
    }
  }
  return OTHER_GROUP;
}

/** Options shown for a command in the overview: not `--help`, and `--json` only when it says something of its own. */
export function shownOptions(command: Command): Option[] {
  return command.options.filter(
    (option) => option.long !== '--help' && !(option.long === '--json' && option.description === JSON_DESCRIPTION),
  );
}

function argumentsOf(command: Command): string {
  return command.registeredArguments
    .map((argument) => {
      const name = `${argument.name()}${argument.variadic ? '...' : ''}`;
      return argument.required ? `<${name}>` : `[${name}]`;
    })
    .join(' ');
}

/**
 * Help of the root and of group commands: every command below, by stage, with
 * its options; the root adds the examples. A command that runs keeps the
 * standard help of commander, which already shows everything about it.
 */
export function formatHelp(command: Command, helper: Help): string {
  if (subcommands(command).length === 0) {
    return Help.prototype.formatHelp.call(helper, command, helper);
  }
  const width = helper.helpWidth ?? 80;
  const root = command.parent === null;
  const name = rootOf(command).name();
  const below = leaves(command, root ? '' : pathOf(command));
  const optionTerm = (option: Option) => helper.optionTerm(option);
  const optionText = (option: Option) => `${helper.optionDescription(option)}${option.mandatory ? ' (required)' : ''}`;
  const commandTerm = (leaf: Leaf) => [leaf.path, argumentsOf(leaf.command)].filter((part) => part !== '').join(' ');

  // One column of descriptions for commands (indent 2) and their options (indent 4), as git and gh do.
  const terms = [
    ...below.map((leaf) => 2 + helper.displayWidth(commandTerm(leaf))),
    ...below.flatMap((leaf) => shownOptions(leaf.command).map((option) => 4 + helper.displayWidth(optionTerm(option)))),
    ...(root ? helper.visibleOptions(command).map((option) => 2 + helper.displayWidth(optionTerm(option))) : []),
  ];
  const column = Math.min(Math.max(0, ...terms) + 2, MAX_TERM_COLUMN);
  const row = (term: string, description: string): string => {
    const wrapped = helper.boxWrap(description, Math.max(20, width - column)).split('\n');
    const head =
      helper.displayWidth(term) + 2 <= column
        ? `${term.padEnd(column)}${wrapped[0] ?? ''}`
        : `${term}\n${' '.repeat(column)}${wrapped[0] ?? ''}`;
    return [head, ...wrapped.slice(1).map((line) => `${' '.repeat(column)}${line}`)].join('\n');
  };

  const out: string[] = [`Usage: ${helper.commandUsage(command)}`, ''];
  const description = helper.commandDescription(command);
  if (description !== '') {
    out.push(helper.boxWrap(description, width), '');
  }
  const order = root ? [...HELP_GROUPS, OTHER_GROUP] : ['Commands'];
  for (const group of order) {
    const members = root ? below.filter((leaf) => groupOf(leaf.command) === group) : below;
    if (members.length === 0) {
      continue;
    }
    out.push(`${group}:`);
    for (const leaf of members) {
      out.push(row(`  ${commandTerm(leaf)}`, helper.commandDescription(leaf.command)));
      out.push(...shownOptions(leaf.command).map((option) => row(`    ${optionTerm(option)}`, optionText(option))));
    }
    out.push('');
  }
  if (root) {
    out.push('Options:', ...helper.visibleOptions(command).map((option) => row(`  ${optionTerm(option)}`, optionText(option))));
    out.push(`  Most commands print JSON with --json.`, '');
    out.push('Examples:', ...EXAMPLES.map((example) => `  ${example.split(' && ').map((part) => `${name} ${part}`).join(' && ')}`), '');
    out.push(`Run "${name} <command> --help" for details, e.g. "${name} help task new".`);
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function rootOf(command: Command): Command {
  let current = command;
  while (current.parent !== null) {
    current = current.parent;
  }
  return current;
}

function pathOf(command: Command): string {
  const names: string[] = [];
  for (let current: Command | null = command; current?.parent; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(' ');
}
