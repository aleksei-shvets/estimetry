import { Command } from 'commander';
import type { ErrorReporter } from '../../application/ports/error-reporter.js';
import type { CliContext } from './cli-context.js';
import { registerAttachCommand } from './commands/attach-command.js';
import { registerCalibrateCommand } from './commands/calibrate-command.js';
import { registerCloseCommands } from './commands/close-commands.js';
import { registerEstimateCommand } from './commands/estimate-command.js';
import { registerExtraCommand } from './commands/extra-command.js';
import { registerUpgradeCommand } from './commands/upgrade-command.js';
import { registerInitCommand } from './commands/init-command.js';
import { registerManualCommand } from './commands/manual-command.js';
import { registerParallelCommand } from './commands/parallel-command.js';
import { registerSimilarCommand } from './commands/similar-command.js';
import { registerStartCommand } from './commands/start-command.js';
import { registerStatusCommand } from './commands/status-command.js';
import { registerTaskCommands } from './commands/task-commands.js';
import { ExitCode, toExitCode } from './exit-codes.js';
import { formatHelp } from './help.js';

export interface CliOptions extends CliContext {
  /** Name the binary was invoked as: `estimetry` or `emt`. */
  readonly name: string;
  readonly version: string;
  readonly errors: ErrorReporter;
}

/**
 * The command tree with its help. Help is configured on the root before any
 * command is registered: subcommands take the setting when they are created.
 */
export function createProgram(options: CliOptions, output: { readonly helpWidth?: number } = {}): Command {
  const program = new Command(options.name)
    .description('Compare estimates with actual effort and reuse the experience in the next estimate')
    .version(options.version, '-v, --version')
    .configureHelp({ formatHelp })
    // Subcommands registered below inherit exit handling and output from the root.
    .exitOverride()
    .configureOutput({
      writeOut: (text) => options.out.print(text.trimEnd()),
      writeErr: (text) => options.out.error(text.trimEnd()),
      // Argument errors reported by commander get the same prefix as ours.
      outputError: (text, write) => write(text.replace(/^error: /, 'estimetry: ')),
      ...(output.helpWidth === undefined ? {} : { getOutHelpWidth: () => output.helpWidth as number }),
    });

  registerInitCommand(program, options);
  registerUpgradeCommand(program, options);
  registerTaskCommands(program, options);
  registerStartCommand(program, options);
  registerAttachCommand(program, options);
  registerSimilarCommand(program, options);
  registerCalibrateCommand(program, options);
  registerEstimateCommand(program, options);
  registerManualCommand(program, options);
  registerExtraCommand(program, options);
  registerParallelCommand(program, options);
  registerStatusCommand(program, options);
  registerCloseCommands(program, options);
  return program;
}

/** Parses `args` (without node and script), runs the command and returns the exit code. */
export async function runCli(args: readonly string[], options: CliOptions): Promise<number> {
  const program = createProgram(options);
  // `help task new` shows the help of `task new`: commander's own `help` looks at one level only.
  const parsed = args[0] === 'help' && args.length > 2 ? [...args.slice(1), '--help'] : [...args];
  try {
    await program.parseAsync(parsed, { from: 'user' });
    return ExitCode.ok;
  } catch (error) {
    return toExitCode(error, options.out, options.errors, `cli:${args.join(' ')}`);
  }
}
