import type { Command } from 'commander';
import { TaskId } from '../../../domain/task/task-id.js';
import { presenterFor, type CliContext } from '../cli-context.js';

export function registerAttachCommand(program: Command, ctx: CliContext): void {
  program
    .command('attach')
    .description('connect a task to the current project (for tasks that span several repositories)')
    .argument('<task>', 'task id, e.g. T-12')
    .option('--json', 'print JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const result = (await ctx.app()).attachTask({ task: TaskId.parse(id) });
      ctx.out.print(presenterFor(options).taskAttached(result));
    });
}
