import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseTaskOption } from '../parse-input.js';

export function registerStatusCommand(program: Command, ctx: CliContext): void {
  program
    .command('status')
    .description('show the fact of a task so far: agents, you, uncertainty, and the estimate')
    .argument('[task]', 'task id; defaults to the only task in progress in this project')
    .option('--json', 'print JSON (durations in minutes)')
    .action(async (id: string | undefined, options: { json?: boolean }) => {
      const view = (await ctx.app()).showStatus(parseTaskOption(id));
      ctx.out.print(presenterFor(options).status(view));
    });
}
