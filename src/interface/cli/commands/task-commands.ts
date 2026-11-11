import type { Command } from 'commander';
import { TaskId } from '../../../domain/task/task-id.js';
import { groupCommand } from '../help-command.js';
import { presenterFor, type CliContext } from '../cli-context.js';

interface JsonOption {
  readonly json?: boolean;
}

export function registerTaskCommands(program: Command, ctx: CliContext): void {
  const task = groupCommand(program, 'task', 'Tasks and estimates', ctx).description('create and inspect tasks');

  task
    .command('new')
    .description('create a task in the current project')
    .argument('<title>', 'short title of the task')
    .option('--type <type>', 'task type: feature, integration, bugfix, refactor, infra, migration, research')
    .option('--ticket <key>', 'key of the ticket in an external tracker')
    .option('--json', 'print JSON')
    .action(async (title: string, options: JsonOption & { type?: string; ticket?: string }) => {
      const view = (await ctx.app()).tasks.create({
        title,
        ...(options.type === undefined ? {} : { type: options.type }),
        ...(options.ticket === undefined ? {} : { ticket: options.ticket }),
      });
      ctx.out.print(presenterFor(options).taskCreated(view));
    });

  task
    .command('list')
    .description('list tasks of the current project')
    .option('--all', 'list tasks of all projects')
    .option('--closed', 'include closed tasks')
    .option('--json', 'print JSON')
    .action(async (options: JsonOption & { all?: boolean; closed?: boolean }) => {
      const all = options.all === true;
      const views = (await ctx.app()).tasks.list({ all, closed: options.closed === true });
      ctx.out.print(presenterFor(options).taskList(views, { all }));
    });

  task
    .command('show')
    .description('show a task')
    .argument('<task>', 'task id, e.g. T-12')
    .option('--json', 'print JSON')
    .action(async (id: string, options: JsonOption) => {
      const view = (await ctx.app()).tasks.show({ task: TaskId.parse(id) });
      ctx.out.print(presenterFor(options).taskDetails(view));
    });
}
