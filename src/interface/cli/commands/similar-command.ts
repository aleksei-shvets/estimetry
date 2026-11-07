import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseCount, parseLabels, parsePositive } from '../parse-input.js';

export function registerSimilarCommand(program: Command, ctx: CliContext): void {
  program
    .command('similar')
    .helpGroup('Tasks and estimates')
    .description('find closed tasks like a new one: their estimates, fact, extra work and lessons')
    .option('--type <type>', 'task type of the new task')
    .option('--stack <labels>', 'comma-separated technologies the task touches; defaults to the stack of the project')
    .option('--hours <hours>', 'preliminary most likely hours of the new task, before calibration')
    .option('--limit <n>', 'how many tasks to show', '5')
    .option('--json', 'print JSON')
    .action(async (options: { type?: string; stack?: string; hours?: string; limit: string; json?: boolean }) => {
      const view = (await ctx.app()).similarTasks({
        ...(options.type === undefined ? {} : { type: options.type }),
        ...(options.stack === undefined ? {} : { stack: parseLabels(options.stack) }),
        ...(options.hours === undefined ? {} : { hours: parsePositive(options.hours, '--hours') }),
        limit: parseCount(options.limit, '--limit', 1),
      });
      ctx.out.print(presenterFor(options).similarTasks(view));
    });
}
