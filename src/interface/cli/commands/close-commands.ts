import type { Command } from 'commander';
import { TaskId } from '../../../domain/task/task-id.js';
import { presenterFor, type CliContext } from '../cli-context.js';
import { ConfirmationRequired, ReportedFailure } from '../exit-codes.js';
import { parseTaskOption, parseTime } from '../parse-input.js';
import { Prompts } from '../prompts.js';

interface CloseOptions {
  readonly at?: string;
  readonly abandoned?: boolean;
  readonly yes?: boolean;
  readonly task?: string;
  readonly json?: boolean;
}

/**
 * Asks in a terminal; elsewhere `--yes` must say the user already agreed
 * (design §2: a task never closes by itself).
 */
async function confirmed(ctx: CliContext, options: { readonly yes?: boolean; readonly json?: boolean }, what: string, summary: () => string, question: string): Promise<boolean> {
  if (options.yes) {
    return true;
  }
  if (!ctx.terminal.interactive || options.json) {
    throw new ConfirmationRequired(what);
  }
  const prompts = new Prompts(ctx.terminal.input, ctx.terminal.output);
  try {
    ctx.terminal.output.write(`${summary()}\n`);
    return await prompts.confirm(question, false);
  } finally {
    prompts.close();
  }
}

function printWarnings(ctx: CliContext, warnings: readonly string[]): void {
  for (const warning of warnings) {
    ctx.out.error(`warning: ${warning}`);
  }
}

export function registerCloseCommands(program: Command, ctx: CliContext): void {
  program
    .command('close')
    .helpGroup('Closing')
    .description('close a task after the user agreed; then run `emt retro`')
    .argument('[task]', 'task id; defaults to the only task in progress in this project')
    .option('--at <time>', 'when the work ended (ISO 8601 or "YYYY-MM-DD HH:MM"); defaults to now')
    .option('--abandoned', 'the task was dropped: it is not used for calibration')
    .option('--yes', 'the user has already agreed to close it (needed without a terminal)')
    .option('--json', 'print JSON')
    .action(async (id: string | undefined, options: CloseOptions) => {
      const app = await ctx.app();
      const task = { ...parseTaskOption(id), near: ctx.cwd };
      const go = await confirmed(ctx, options, 'closing a task', () => presenterFor(options).closeSummary(app.closing.summary(task)), 'Close the task?');
      if (!go) {
        ctx.out.error('Not closed.');
        return;
      }
      const closed = app.closing.close({
        ...task,
        ...(options.at === undefined ? {} : { at: parseTime(options.at) }),
        ...(options.abandoned ? { abandoned: true } : {}),
      });
      printWarnings(ctx, closed.warnings);
      ctx.out.print(presenterFor(options).taskClosed(closed));
    });

  program
    .command('reopen')
    .helpGroup('Closing')
    .description('open a task closed by mistake')
    .argument('<task>', 'task id, e.g. T-12')
    .option('--json', 'print JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const reopened = (await ctx.app()).closing.reopen({ task: TaskId.parse(id) });
      printWarnings(ctx, reopened.warnings);
      ctx.out.print(presenterFor(options).taskReopened(reopened));
    });

  program
    .command('retro')
    .helpGroup('Closing')
    .description('record why the fact differs from the estimate, and one lesson')
    .argument('[task]', 'task id; defaults to the task of this project closed last')
    .requiredOption('--reason <text>', 'a reason, optionally "<part id>: <text>"; repeat for several', (value: string, all: string[] = []) => [...all, value])
    .requiredOption('--lesson <text>', 'one lesson for the next estimate')
    .option('--json', 'print JSON')
    .action(async (id: string | undefined, options: { reason: string[]; lesson: string; json?: boolean }) => {
      const recorded = (await ctx.app()).closing.retro({ ...parseTaskOption(id), reasons: options.reason, lesson: options.lesson });
      printWarnings(ctx, recorded.warnings);
      ctx.out.print(presenterFor(options).retroRecorded(recorded));
    });

  program
    .command('renegotiate')
    .helpGroup('Closing')
    .description('the customer agreed to more work: close the task as it is and start a new one for the rest')
    .argument('<title>', 'title of the new task')
    .option('--task <id>', 'the task being renegotiated; defaults to the only task in progress in this project')
    .option('--description <text>', 'what changed; defaults to the title')
    .option('--category <category>', 'category of the extra work, new-requirement by default')
    .option('--type <type>', 'type of the new task; defaults to the type of the original')
    .option('--at <time>', 'when the original work ended; defaults to now')
    .option('--yes', 'the user has already agreed (needed without a terminal)')
    .option('--json', 'print JSON')
    .action(async (title: string, options: CloseOptions & { description?: string; category?: string; type?: string }) => {
      const app = await ctx.app();
      const task = { ...parseTaskOption(options.task), near: ctx.cwd };
      const go = await confirmed(
        ctx,
        options,
        'renegotiating a task',
        () => {
          const original = app.closing.renegotiationTarget(task);
          return `${original.id} "${original.title}" closes as it is; the rest becomes the new task "${title}".`;
        },
        'Renegotiate?',
      );
      if (!go) {
        ctx.out.error('Nothing changed.');
        return;
      }
      const result = app.closing.renegotiate({
        ...task,
        title,
        ...(options.description === undefined ? {} : { description: options.description }),
        ...(options.category === undefined ? {} : { category: options.category }),
        ...(options.type === undefined ? {} : { type: options.type }),
        ...(options.at === undefined ? {} : { at: parseTime(options.at) }),
      });
      printWarnings(ctx, result.closed.warnings);
      ctx.out.print(presenterFor(options).renegotiated(result));
    });

  program
    .command('rebuild')
    .helpGroup('Setup')
    .description('rebuild task snapshots, cards and calibration.json from the journals')
    .argument('[task]', 'only this task')
    .option('--json', 'print JSON')
    .action(async (id: string | undefined, options: { json?: boolean }) => {
      const report = (await ctx.app()).closing.rebuild(parseTaskOption(id));
      ctx.out.print(presenterFor(options).rebuildReport(report));
      if (report.failed.length > 0 || report.calibrationError !== undefined) {
        throw new ReportedFailure();
      }
    });
}
