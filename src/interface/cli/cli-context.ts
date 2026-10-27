import type { Estimetry } from '../../application/estimetry.js';
import type { CliOutput } from './cli-output.js';
import { jsonPresenter } from './presenters/json-presenter.js';
import type { Presenter } from './presenters/presenter.js';
import { textPresenter } from './presenters/text-presenter.js';

/** What every command gets: the application facade (built on demand) and the output. */
export interface CliContext {
  readonly app: () => Promise<Estimetry>;
  readonly out: CliOutput;
}

export function presenterFor(options: { readonly json?: boolean }): Presenter {
  return options.json ? jsonPresenter : textPresenter;
}
