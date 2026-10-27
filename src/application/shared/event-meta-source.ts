import type { EventMeta } from '../../domain/shared/event-envelope.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';

/** Stamps new domain events with id, time and author taken from the ports. */
export class EventMetaSource {
  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly authors: AuthorProvider,
  ) {}

  next(): EventMeta {
    return { id: this.ids.next(), at: this.clock.now(), author: this.authors.current() };
  }
}
