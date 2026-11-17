import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseTaskOption } from '../parse-input.js';

export function registerStatusCommand(program: Command, ctx: CliContext): void {
  program
    .command('status')
    .helpGroup('Measuring')
    .description('show the fact of a task so far: agents, you, uncertainty, and the estimate')
    .argument('[task]', 'task id; defaults to the only task in progress in this project')
    .option('--json', 'print JSON (durations in minutes)')
    .action(async (id: string | undefined, options: { json?: boolean }) => {
      const app = await ctx.app();
      const view = app.measuring.status({ ...parseTaskOption(id), near: ctx.cwd });
      const presenter = presenterFor(options);
      ctx.out.print(presenter.status(view));
      presenter.notices.tools(app.project.notices()).forEach((line) => ctx.out.error(line));
    });
}
