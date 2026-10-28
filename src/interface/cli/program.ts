import { Command } from 'commander';
import type { ErrorReporter } from '../../application/ports/error-reporter.js';
import type { CliContext } from './cli-context.js';
import { registerAttachCommand } from './commands/attach-command.js';
import { registerEstimateCommand } from './commands/estimate-command.js';
import { registerExtraCommand } from './commands/extra-command.js';
import { registerManualCommand } from './commands/manual-command.js';
import { registerParallelCommand } from './commands/parallel-command.js';
import { registerStartCommand } from './commands/start-command.js';
import { registerStatusCommand } from './commands/status-command.js';
import { registerTaskCommands } from './commands/task-commands.js';
import { ExitCode, toExitCode } from './exit-codes.js';

export interface CliOptions extends CliContext {
  /** Name the binary was invoked as: `estimetry` or `emt`. */
  readonly name: string;
  readonly version: string;
  readonly errors: ErrorReporter;
}

/** Parses `args` (without node and script), runs the command and returns the exit code. */
export async function runCli(args: readonly string[], options: CliOptions): Promise<number> {
  const program = new Command(options.name)
    .description('Compare estimates with actual effort and reuse the experience in the next estimate')
    .version(options.version, '-v, --version')
    // Subcommands registered below inherit exit handling and output from the root.
    .exitOverride()
    .configureOutput({
      writeOut: (text) => options.out.print(text.trimEnd()),
      writeErr: (text) => options.out.error(text.trimEnd()),
      // Argument errors reported by commander get the same prefix as ours.
      outputError: (text, write) => write(text.replace(/^error: /, 'estimetry: ')),
    });

  registerTaskCommands(program, options);
  registerStartCommand(program, options);
  registerAttachCommand(program, options);
  registerEstimateCommand(program, options);
  registerManualCommand(program, options);
  registerExtraCommand(program, options);
  registerParallelCommand(program, options);
  registerStatusCommand(program, options);

  try {
    await program.parseAsync([...args], { from: 'user' });
    return ExitCode.ok;
  } catch (error) {
    return toExitCode(error, options.out, options.errors, `cli:${args.join(' ')}`);
  }
}
