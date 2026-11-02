import type { Command } from 'commander';
import { groupCommand } from '../help-command.js';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseCount, parseTaskOption } from '../parse-input.js';

interface OnOptions {
  readonly reason?: string;
  readonly agents?: string;
  readonly parts?: string;
  readonly task?: string;
  readonly json?: boolean;
}

export function registerParallelCommand(program: Command, ctx: CliContext): void {
  const parallel = groupCommand(program, 'parallel', 'Measuring', ctx).description('switch parallel mode of a task (several agents at once)');

  parallel
    .command('on')
    .description('switch parallel mode on; records how much of the budget is spent')
    .option('--reason <text>', 'why the work goes parallel')
    .option('--agents <n>', 'number of agents')
    .option('--parts <ids>', 'comma-separated ids of the estimate parts done in parallel')
    .option('--task <id>', 'task id; defaults to the only task in progress in this project')
    .option('--json', 'print JSON')
    .action(async (options: OnOptions) => {
      const changed = (await ctx.app()).changeParallelMode({
        enabled: true,
        ...(options.reason === undefined ? {} : { reason: options.reason }),
        ...(options.agents === undefined ? {} : { agents: parseCount(options.agents, '--agents', 1) }),
        ...(options.parts === undefined ? {} : { parts: options.parts.split(',') }),
        ...parseTaskOption(options.task),
      });
      ctx.out.print(presenterFor(options).parallelModeChanged(changed));
    });

  parallel
    .command('off')
    .description('switch parallel mode off')
    .option('--task <id>', 'task id; defaults to the only task in progress in this project')
    .option('--json', 'print JSON')
    .action(async (options: { task?: string; json?: boolean }) => {
      const changed = (await ctx.app()).changeParallelMode({ enabled: false, ...parseTaskOption(options.task) });
      ctx.out.print(presenterFor(options).parallelModeChanged(changed));
    });
}
