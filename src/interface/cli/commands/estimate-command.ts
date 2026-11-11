import type { Command } from 'commander';
import { InvalidValue } from '../../../domain/shared/domain-error.js';
import { groupCommand } from '../help-command.js';
import { presenterFor, type CliContext } from '../cli-context.js';
import { formatMinutes } from '../presenters/text/format.js';
import { parseTaskOption, parseTime } from '../parse-input.js';
import type { RevisionCandidates } from '../../../application/task/find-revision-candidates.js';

interface ReviseOptions {
  readonly reason?: string;
  readonly category?: string;
  readonly spent?: string;
  readonly lostFrom?: string;
  readonly covers?: string[];
  readonly at?: string;
  readonly task?: string;
  readonly repair?: boolean;
  readonly json?: boolean;
}

export function registerEstimateCommand(program: Command, ctx: CliContext): void {
  const estimate = groupCommand(program, 'estimate', 'Tasks and estimates', ctx).description('work with the estimate of a task');
  registerSave(estimate, ctx);
  registerRevise(estimate, ctx);
}

/** `emt estimate save`: an estimate file becomes the plan of a task. */
function registerSave(estimate: Command, ctx: CliContext): void {
  estimate
    .command('save')
    .description('make an estimate file the plan of a task (allowed until work starts)')
    .argument('<file>', 'estimate file (YAML)')
    .option('--task <id>', 'task id; defaults to the only new or estimated task of this project')
    .option('--json', 'print JSON')
    .action(async (file: string, options: { task?: string; json?: boolean }) => {
      const saved = (await ctx.app()).estimates.save({ file, ...parseTaskOption(options.task) });
      for (const kind of saved.missingKinds) {
        ctx.out.error(`warning: the estimate has no ${kind} part`);
      }
      ctx.out.print(presenterFor(options).estimateSaved(saved));
    });
}

/** `emt estimate revise`: a new plan of a task in progress, or `--repair` of its missing snapshot. */
function registerRevise(estimate: Command, ctx: CliContext): void {
  estimate
    .command('revise')
    .description('revise the plan of a task in progress: the old estimate stays, the new one is compared with the counted fact')
    .argument('[file]', 'estimate file (YAML) with the new plan')
    .option('--reason <text>', 'why the plan changed: a short summary agreed with the user')
    .option('--category <category>', 'new-requirement, missed-analysis, rework or environment')
    .option('--spent <policy>', 'include: work so far counts; exclude: work in the lost window was thrown away')
    .option('--lost-from <time>', 'with exclude: when the work started going the wrong way (ISO 8601 or "YYYY-MM-DD HH:MM")')
    .option('--covers <id>', 'id of extra work that describes the same loss; repeat for several', (value: string, all: string[] = []) => [...all, value])
    .option('--at <time>', 'when the new estimate starts to hold; defaults to now')
    .option('--task <id>', 'task id; defaults to the only task in progress in this project')
    .option('--repair', 'write the missing plan snapshot of the last revision')
    .option('--json', 'print JSON')
    .action((file: string | undefined, options: ReviseOptions) => revise(ctx, file, options));
}

async function revise(ctx: CliContext, file: string | undefined, options: ReviseOptions): Promise<void> {
  const app = await ctx.app();
  const task = { ...parseTaskOption(options.task), near: ctx.cwd };
  if (options.repair) {
    const repaired = app.estimates.repairRevision(task);
    ctx.out.print(options.json ? JSON.stringify(repaired, null, 2) : `Wrote the plan snapshot of revision ${repaired.revision} of ${repaired.task.id}.`);
    return;
  }
  if (file === undefined || options.reason === undefined) {
    throw new InvalidValue('emt estimate revise needs the estimate file and --reason');
  }
  const lostFrom = options.lostFrom === undefined ? undefined : parseTime(options.lostFrom);
  // What --covers may name and what stays counted, before anything is written.
  printCandidates(
    ctx,
    app.estimates.revisionCandidates({ ...task, ...(lostFrom === undefined ? {} : { lostFrom }), ...(options.spent === undefined ? {} : { spent: options.spent }) }),
    options.covers ?? [],
  );
  const revised = app.estimates.revise({
    ...task,
    file,
    reason: options.reason,
    ...(options.category === undefined ? {} : { category: options.category }),
    ...(options.spent === undefined ? {} : { spent: options.spent }),
    ...(lostFrom === undefined ? {} : { lostFrom }),
    ...(options.covers === undefined ? {} : { covers: options.covers }),
    ...(options.at === undefined ? {} : { at: parseTime(options.at) }),
  });
  ctx.out.print(presenterFor(options).estimateRevised(revised));
}

/** Extra work the revision covers or leaves counted, and untimed manual time that stays. */
function printCandidates(ctx: CliContext, candidates: RevisionCandidates, covers: readonly string[]): void {
  for (const extra of candidates.extras) {
    const covered = covers.includes(extra.id);
    ctx.out.error(
      `${covered ? 'covered by this revision' : 'note: not covered (add --covers ' + extra.id + ' if it is the same loss)'}: ` +
        `extra ${extra.category}${extra.minutes === null ? '' : ` ${formatMinutes(extra.minutes)}`} "${extra.description}" [${extra.id}]`,
    );
  }
  for (const manual of candidates.untimedManual) {
    ctx.out.error(`note: manual time without a moment stays counted: ${formatMinutes(manual.minutes)} "${manual.description}"`);
  }
}
