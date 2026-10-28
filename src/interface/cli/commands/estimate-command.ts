import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseTaskOption } from '../parse-input.js';

export function registerEstimateCommand(program: Command, ctx: CliContext): void {
  const estimate = program.command('estimate').description('work with the estimate of a task');

  estimate
    .command('save')
    .description('make an estimate file the plan of a task (allowed until work starts)')
    .argument('<file>', 'estimate file (YAML)')
    .option('--task <id>', 'task id; defaults to the only new or estimated task of this project')
    .option('--json', 'print JSON')
    .action(async (file: string, options: { task?: string; json?: boolean }) => {
      const saved = (await ctx.app()).saveEstimate({ file, ...parseTaskOption(options.task) });
      for (const kind of saved.missingKinds) {
        ctx.out.error(`warning: the estimate has no ${kind} part`);
      }
      ctx.out.print(presenterFor(options).estimateSaved(saved));
    });
}
