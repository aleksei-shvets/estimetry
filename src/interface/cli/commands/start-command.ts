import type { Command } from 'commander';
import { TaskId } from '../../../domain/task/task-id.js';
import { presenterFor, type CliContext } from '../cli-context.js';
import { unestimatedWarning } from '../presenters/text-presenter.js';

export function registerStartCommand(program: Command, ctx: CliContext): void {
  program
    .command('start')
    .description('start work on a task; from now on its effort is recorded')
    .argument('[task]', 'task id; defaults to the only task of this project that can be started')
    .option('--json', 'print JSON')
    .action(async (id: string | undefined, options: { json?: boolean }) => {
      const view = (await ctx.app()).startTask(id === undefined ? {} : { task: TaskId.parse(id) });
      if (!view.estimated) {
        ctx.out.error(unestimatedWarning(view));
      }
      ctx.out.print(presenterFor(options).taskStarted(view));
    });
}
