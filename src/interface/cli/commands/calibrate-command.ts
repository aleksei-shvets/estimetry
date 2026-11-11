import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseLabels } from '../parse-input.js';

export function registerCalibrateCommand(program: Command, ctx: CliContext): void {
  program
    .command('calibrate')
    .helpGroup('Tasks and estimates')
    .description('show your coefficients for a type and a stack, and the one an estimate may apply')
    .option('--type <type>', 'task type of the task being estimated')
    .option('--stack <labels>', 'comma-separated technologies the task touches; defaults to the stack of the project')
    .option('--revise', 'for a revision of a task in progress: the coefficient of estimates made during work')
    .option('--json', 'print JSON')
    .action(async (options: { type?: string; stack?: string; revise?: boolean; json?: boolean }) => {
      const view = (await ctx.app()).estimates.calibration({
        ...(options.type === undefined ? {} : { type: options.type }),
        ...(options.stack === undefined ? {} : { stack: parseLabels(options.stack) }),
        revise: options.revise === true,
      });
      ctx.out.print(presenterFor(options).calibration(view));
    });
}
