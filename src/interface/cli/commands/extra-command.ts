import type { Command } from 'commander';
import { EXTRA_CATEGORIES } from '../../../application/task/record-extra.js';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseCount, parseDuration, parseTaskOption } from '../parse-input.js';

interface ExtraOptions {
  readonly category: string;
  readonly time?: string;
  readonly lines?: string;
  readonly change?: string;
  readonly task?: string;
  readonly json?: boolean;
}

export function registerExtraCommand(program: Command, ctx: CliContext): void {
  program
    .command('extra')
    .helpGroup('Measuring')
    .description('record work outside the estimated plan')
    .argument('<description>', 'what the extra work was')
    .requiredOption('--category <category>', `one of: ${EXTRA_CATEGORIES.join(', ')}`)
    .option('--time <duration>', 'your guess of what it cost; does not change the fact')
    .option('--lines <n>', 'lines of code it took')
    .option('--change <name>', 'change it belongs to')
    .option('--task <id>', 'task id; defaults to the only task in progress in this project')
    .option('--json', 'print JSON')
    .action(async (description: string, options: ExtraOptions) => {
      const recorded = (await ctx.app()).recordExtra({
        description,
        category: options.category,
        ...(options.time === undefined ? {} : { time: parseDuration(options.time) }),
        ...(options.lines === undefined ? {} : { lines: parseCount(options.lines, '--lines', 0) }),
        ...(options.change === undefined ? {} : { change: options.change }),
        ...parseTaskOption(options.task),
      });
      ctx.out.print(presenterFor(options).extraRecorded(recorded));
    });
}
