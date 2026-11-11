import type { HookCall } from '../../application/hooks/hook-call.js';
import type { Estimetry } from '../../application/estimetry.js';
import type { CliOutput } from './cli-output.js';
import { jsonPresenter } from './presenters/json-presenter.js';
import type { Presenter } from './presenters/presenter.js';
import { textPresenter } from './presenters/text-presenter.js';

/** The streams of the process; `interactive` when both ends are a terminal and not in CI. */
export interface Terminal {
  readonly interactive: boolean;
  readonly input: NodeJS.ReadableStream & { readonly isTTY?: boolean };
  readonly output: NodeJS.WritableStream;
}

/** What every command gets: the application facade (built on demand) and the output. */
export interface CliContext {
  readonly app: () => Promise<Estimetry>;
  /** The hook receiver alone: hooks run on every tool call and must not load storage or git. */
  readonly hooks: () => Promise<{ receive(call: HookCall): Promise<string | undefined> }>;
  readonly out: CliOutput;
  readonly terminal: Terminal;
  /** The directory the command runs in: the working copy whose plan a command reads (`near` of the application). */
  readonly cwd: string;
}

export function presenterFor(options: { readonly json?: boolean }): Presenter {
  return options.json ? jsonPresenter : textPresenter;
}
