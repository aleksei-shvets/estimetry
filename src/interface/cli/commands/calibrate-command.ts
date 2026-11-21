import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseLabels } from '../parse-input.js';

/** The settings `emt calibrate` follows: help names them, the README shows what to expect from each. */
const SETTINGS_HELP = `
Settings (config.yaml in ~/.local/share/estimetry, or in $ESTIMETRY_HOME):
  calibration.minTasks  a slice counts from this many closed tasks; with fewer
                        in all your tasks there is no coefficient (default 1)
  calibration.shrink    k in the weight n / (n + k) of a slice: larger is more
                        cautious, 0 applies the median as it is (default 2)
  minTasks set without shrink means shrink: 0; minTasks: 5 alone gives the
  coefficients of 0.2. Change them and run calibrate again: it recomputes from
  your cards at once. The README shows what to expect from each setting.`;

export function registerCalibrateCommand(program: Command, ctx: CliContext): void {
  program
    .command('calibrate')
    .helpGroup('Tasks and estimates')
    .description('show your coefficients for a type and a stack, and the one an estimate may apply')
    .addHelpText('after', SETTINGS_HELP)
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
