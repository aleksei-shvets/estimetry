import type { Command } from 'commander';
import type { CliContext } from './cli-context.js';
import { ReportedFailure } from './exit-codes.js';
import type { HelpGroup } from './help.js';

/**
 * A command that only groups others (`task`, `estimate`, `parallel`). Typed
 * alone it prints its help to stdout and exits with 1: the command is incomplete.
 */
export function groupCommand(program: Command, name: string, group: HelpGroup, ctx: Pick<CliContext, 'out'>): Command {
  return program
    .command(name)
    .helpGroup(group)
    .action((...args: unknown[]) => {
      const command = args.at(-1) as Command;
      ctx.out.print(command.helpInformation().trimEnd());
      throw new ReportedFailure();
    });
}
