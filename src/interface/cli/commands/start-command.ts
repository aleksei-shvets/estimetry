import type { Command } from 'commander';
import { TaskId } from '../../../domain/task/task-id.js';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseTime } from '../parse-input.js';
import { unestimatedWarning } from '../presenters/text/task-text.js';

export function registerStartCommand(program: Command, ctx: CliContext): void {
  program
    .command('start')
    .helpGroup('Measuring')
    .description('start work on a task; from now on its effort is recorded')
    .argument('[task]', 'task id; defaults to the only task of this project that can be started')
    .option('--at <time>', 'backdate the start (ISO 8601 or "YYYY-MM-DD HH:MM"), for work begun earlier')
    .option('--json', 'print JSON')
    .action(async (id: string | undefined, options: { at?: string; json?: boolean }) => {
      const view = (await ctx.app()).tasks.start({
        near: ctx.cwd,
        ...(id === undefined ? {} : { task: TaskId.parse(id) }),
        ...(options.at === undefined ? {} : { at: parseTime(options.at) }),
      });
      if (!view.estimated) {
        ctx.out.error(unestimatedWarning(view));
      }
      ctx.out.print(presenterFor(options).taskStarted(view));
    });
}
