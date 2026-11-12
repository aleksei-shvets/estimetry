import type { EstimetryRunner } from '../ports/estimetry-runner.js';

/** The first word of a command with the paths of an installation. */
const RUNNER_MARKER = 'estimetry_home=';

/**
 * A POSIX shell command that runs `estimetry <args>` (estimetry-command, one
 * rule for every hook): this installation by its paths while they exist, else
 * `estimetry` from PATH. ESTIMETRY_HOME set by the user wins over the one of `init`.
 */
export function estimetryCommand(runner: EstimetryRunner | undefined, args: string): string {
  const fromPath = `estimetry ${args}`;
  if (runner === undefined) {
    return fromPath;
  }
  const node = quoted(runner.node);
  const main = quoted(runner.main);
  return (
    `${RUNNER_MARKER}${quoted(runner.home)}; ` +
    `if [ -x ${node} ] && [ -f ${main} ]; then ESTIMETRY_HOME="\${ESTIMETRY_HOME:-$estimetry_home}" ${node} ${main} ${args}; ` +
    `else ${fromPath}; fi`
  );
}

/**
 * Whether a command is one `estimetryCommand` writes for these arguments, in
 * either form, or a command of an older version (`estimetry <args> …`): hooks
 * are recognised on reinstall by the same rule that writes them.
 */
export function isEstimetryCommand(command: string, argsPrefix: string): boolean {
  const fromPath = `estimetry ${argsPrefix}`;
  const plain = command === fromPath || command.startsWith(`${fromPath} `);
  const withPaths = command.startsWith(RUNNER_MARKER) && command.includes(`; else ${fromPath} `) && command.endsWith('; fi');
  return plain || withPaths;
}

/** A path for a POSIX shell in single quotes: spaces and quotes in it stay one word. */
function quoted(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}
