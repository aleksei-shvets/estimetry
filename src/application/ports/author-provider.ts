import type { Author } from '../../domain/shared/author.js';

export interface AuthorProvider {
  /** The current author profile; created and remembered on first use. */
  current(): Author;
}
