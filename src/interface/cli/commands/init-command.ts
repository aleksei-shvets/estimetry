import type { Command } from 'commander';
import type { InitInput } from '../../../application/project/init-project.js';
import type { InitChoices } from '../../../application/project/show-init-choices.js';
import { SHARE_MODES, type ShareMode } from '../../../application/ports/sharing-preference.js';
import { presenterFor, type CliContext } from '../cli-context.js';
import { Prompts } from '../prompts.js';

interface InitOptions {
  readonly tools?: string;
  readonly flow?: string;
  readonly share?: string;
  readonly trackCommits?: boolean;
  readonly sharedHooks?: boolean;
  readonly trustHooks?: boolean;
  readonly force?: boolean;
  readonly interactive: boolean;
  readonly json?: boolean;
}

/** Shown in the questions so users see where estimetry is going; not registered until they work. */
const COMING_SOON = {
  tools: [{ value: 'cursor', label: 'Cursor' }],
  flows: [
    { value: 'spec-kit', label: 'GitHub Spec Kit' },
    { value: 'custom', label: 'Your own, from .estimetry/flow.yaml' },
  ],
} as const;

const SHARE_HINTS: Readonly<Record<ShareMode, string>> = {
  none: 'your data stays on this machine; + private, − no team baseline',
  calibration: 'share calibration coefficients with the team; + team baseline, − mixes the speed of different people (saved only for now)',
  cards:
    'exchange anonymised task cards; + more similar tasks to learn from, − descriptions need review before sharing (saved only for now)',
};

export function registerInitCommand(program: Command, ctx: CliContext): void {
  program
    .command('init')
    .helpGroup('Setup')
    .description('set up estimetry in this project: hooks, skills and commands of the AI tool, project config')
    .option('--tools <ids>', 'AI tools, comma-separated: claude-code, codex (default: installed, else found on this machine)')
    .option('--flow <id>', 'development process: openspec or none (default: detected)')
    .option('--share <mode>', `sharing with the team: ${SHARE_MODES.join(', ')}`)
    .option('--track-commits', 'install a git post-commit hook')
    .option('--no-track-commits', 'remove the git post-commit hook')
    .option('--shared-hooks', 'install for the whole team, into files the project commits')
    .option('--no-shared-hooks', 'install for yourself only (default)')
    .option('--trust-hooks', 'trust the hooks in tools that ask for it (Codex) and let its task commands run outside their sandbox')
    .option('--no-trust-hooks', 'trust nothing, take away the rule for the task commands (without either flag: kept as it is)')
    .option('--force', 'overwrite generated skills you have edited')
    .option('--no-interactive', 'do not ask; use flags and defaults')
    .option('--json', 'print JSON')
    .action(async (options: InitOptions) => {
      const app = await ctx.app();
      const choices = app.project.choices();
      const input =
        ctx.terminal.interactive && options.interactive && !options.json ? await ask(ctx, choices, options) : fromFlags(options);
      ctx.out.print(presenterFor(options).initReport(app.project.init(input)));
    });
}

function fromFlags(options: InitOptions): InitInput {
  return {
    ...(options.tools === undefined ? {} : { tools: options.tools.split(',').filter((id) => id.trim() !== '') }),
    ...(options.flow === undefined ? {} : { flow: options.flow }),
    ...(options.share === undefined ? {} : { share: options.share }),
    ...(options.trackCommits === undefined ? {} : { trackCommits: options.trackCommits }),
    ...(options.sharedHooks === undefined ? {} : { shared: options.sharedHooks }),
    ...(options.trustHooks === undefined ? {} : { trustHooks: options.trustHooks }),
    ...(options.force ? { force: true } : {}),
  };
}

/** Asks only about what the flags left open. */
async function ask(ctx: CliContext, choices: InitChoices, options: InitOptions): Promise<InitInput> {
  const prompts = new Prompts(ctx.terminal.input, ctx.terminal.output);
  try {
    const { defaults } = choices;
    const input: { -readonly [K in keyof InitInput]: InitInput[K] } = fromFlags(options);
    if (input.tools === undefined) {
      input.tools = await prompts.multiSelect(
        'AI tools',
        [
          ...choices.tools.map((tool) => ({ value: tool.id, label: tool.title })),
          // A tool that is registered is never "coming soon", even if this list lags behind.
          ...COMING_SOON.tools
            .filter((soon) => !choices.tools.some((tool) => tool.id === soon.value))
            .map((tool) => ({ ...tool, disabled: true })),
        ],
        defaults.tools,
      );
    }
    if (input.flow === undefined) {
      input.flow = await prompts.select(
        'Development process',
        [
          ...choices.flows.map((flow) => ({ value: flow.id, label: flow.title })),
          ...COMING_SOON.flows.map((flow) => ({ ...flow, disabled: true })),
        ],
        defaults.flow,
      );
    }
    if (input.share === undefined) {
      input.share = await prompts.select(
        'Share with the team',
        SHARE_MODES.map((mode) => ({ value: mode, label: mode, hint: SHARE_HINTS[mode] })),
        defaults.share,
      );
    }
    if (input.trackCommits === undefined) {
      input.trackCommits = await prompts.confirm('Install a git post-commit hook to link commits to tasks?', defaults.trackCommits);
    }
    const asking = choices.tools.filter((tool) => tool.asksTrust && (input.tools ?? defaults.tools).includes(tool.id));
    if (input.trustHooks === undefined && asking.length > 0) {
      const titles = asking.map((tool) => tool.title).join(', ');
      input.trustHooks = await prompts.confirm(
        `${titles} runs a hook only after you trust it, and the agent's commands in a sandbox. ` +
          'Trust the estimetry hooks and let its task commands (emt start, extra, close…) run outside the sandbox?',
        true,
      );
    }
    const shared = input.shared ?? defaults.shared;
    if (!shared && choices.unignoredPersonalFiles.length > 0) {
      input.excludePersonalFiles = await prompts.confirm(
        `${choices.unignoredPersonalFiles.join(', ')} is not ignored by git. Add it to your global git excludes?`,
        true,
      );
    }
    return input;
  } finally {
    prompts.close();
  }
}
