import type { Command } from 'commander';
import { TaskId } from '../../../domain/task/task-id.js';
import { presenterFor, type CliContext } from '../cli-context.js';

export function registerAttachCommand(program: Command, ctx: CliContext): void {
  program
    .command('attach')
    .helpGroup('Measuring')
    .description('connect a task to the current project (for tasks that span several repositories)')
    .argument('<task>', 'task id, e.g. T-12')
    .option('--session <id>', 'also bind this session of the AI tool to the task (when several tasks are in progress)')
    .option('--json', 'print JSON')
    .action(async (id: string, options: { session?: string; json?: boolean }) => {
      const result = (await ctx.app()).attachTask({ task: TaskId.parse(id), ...(options.session === undefined ? {} : { session: options.session }) });
      ctx.out.print(presenterFor(options).taskAttached(result));
    });
}
