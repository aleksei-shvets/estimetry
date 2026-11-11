import type { AuthorProvider } from '../ports/author-provider.js';
import type { CalibrationSettings } from '../ports/calibration-settings.js';

/**
 * Who the current author is among the cards: their id, and their earlier ids
 * (`author.aliases`, a changed email) whose cards are theirs too.
 */
export class AuthorAliases {
  constructor(
    private readonly authors: AuthorProvider,
    private readonly settings: Pick<CalibrationSettings, 'authorAliases'>,
  ) {}

  /** The id of the current author. */
  current(): string {
    return this.authors.current().id;
  }

  /** The author's earlier ids, each to the current one. */
  toCurrent(): ReadonlyMap<string, string> {
    const author = this.current();
    return new Map(this.settings.authorAliases().map((alias) => [alias, author]));
  }
}
