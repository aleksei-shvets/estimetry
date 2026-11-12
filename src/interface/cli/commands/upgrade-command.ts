import type { Command } from 'commander';
import { presenterFor, type CliContext } from '../cli-context.js';
import { ConfirmationRequired, ReportedFailure } from '../exit-codes.js';
import { Prompts } from '../prompts.js';

interface UpgradeOptions {
  readonly yes?: boolean;
  readonly json?: boolean;
}

/**
 * `emt upgrade` (project-init spec): shows what it would change in every
 * registered working copy, then asks; without a terminal `--yes` must say the
 * user already agreed, so an agent cannot upgrade on its own.
 */
export function registerUpgradeCommand(program: Command, ctx: CliContext): void {
  program
    .command('upgrade')
    .helpGroup('Setup')
    .description('after updating estimetry: set it up again in every project on this machine, each with its own choices')
    .option('--yes', 'the user has already agreed (needed without a terminal)')
    .option('--json', 'print JSON')
    .action(async (options: UpgradeOptions) => {
      const app = await ctx.app();
      const presenter = presenterFor(options);
      if (!options.yes) {
        const plan = app.project.upgradePlan();
        if (plan.copies.length === 0) {
          ctx.out.print(presenter.upgradePlan(plan));
          return;
        }
        if (!ctx.terminal.interactive || options.json) {
          ctx.out.print(presenter.upgradePlan(plan));
          throw new ConfirmationRequired('upgrading every project');
        }
        if (!(await ask(ctx, presenter.upgradePlan(plan)))) {
          ctx.out.error('Not upgraded.');
          return;
        }
      }
      const report = app.project.upgrade();
      ctx.out.print(presenter.upgradeReport(report));
      if (report.failed.length > 0) {
        throw new ReportedFailure();
      }
    });
}

async function ask(ctx: CliContext, plan: string): Promise<boolean> {
  const prompts = new Prompts(ctx.terminal.input, ctx.terminal.output);
  try {
    ctx.terminal.output.write(`${plan}\n`);
    return await prompts.confirm('Upgrade these working copies?', false);
  } finally {
    prompts.close();
  }
}
