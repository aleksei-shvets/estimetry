import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { parseDuration, parseTaskOption, parseTime } from '../parse-input.js';
import { formatMinutes } from '../presenters/text-presenter.js';

interface ManualOptions {
  readonly at?: string;
  readonly agent?: boolean;
  readonly task?: string;
  readonly json?: boolean;
}

export function registerManualCommand(program: Command, ctx: CliContext): void {
  program
    .command('manual')
    .description('record time the hooks did not see: your work outside agent sessions, or agent work with --agent')
    .argument('<duration>', 'e.g. 40m, 1h30m, 1.5h')
    .argument('<description>', 'what the time was spent on')
    .option('--at <time>', 'when the work ended (ISO 8601 or "YYYY-MM-DD HH:MM"); merges with measured time')
    .option('--agent', 'agent time, e.g. work done before estimetry was installed')
    .option('--task <id>', 'task id; defaults to the only task in progress in this project')
    .option('--json', 'print JSON')
    .action(async (duration: string, description: string, options: ManualOptions) => {
      const recorded = (await ctx.app()).recordManualTime({
        kind: options.agent ? 'agent' : 'user',
        duration: parseDuration(duration),
        description,
        ...(options.at === undefined ? {} : { at: parseTime(options.at) }),
        ...parseTaskOption(options.task),
      });
      if (recorded.overlapsMeasured) {
        ctx.out.error(
          `warning: the last ${formatMinutes(recorded.minutes)} of ${recorded.task.id} are already partly measured; ` +
            'the record was added on top of them. If it is the same time, record it with --at so it merges instead',
        );
      }
      ctx.out.print(presenterFor(options).manualTimeRecorded(recorded));
    });
}
