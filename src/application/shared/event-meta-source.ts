import type { EventMeta } from '../../domain/shared/event-envelope.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
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

  /** The clock's now, for what is stamped later or compared with the moment of a record. */
  now(): Timestamp {
    return this.clock.now();
  }

  /** An id alone, for a value that ties several records together. */
  id(): string {
    return this.ids.next();
  }

  next(): EventMeta {
    return { id: this.ids.next(), at: this.clock.now(), author: this.authors.current() };
  }

  /** A record whose moment is known already: the start of a hook, a measurement, the closing. */
  at(moment: Timestamp): EventMeta {
    return { id: this.ids.next(), at: moment, author: this.authors.current() };
  }
}
