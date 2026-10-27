import { InvalidValue } from './domain-error.js';

/** The person whose experience a record belongs to; calibration is always per author. */
export class Author {
  private constructor(readonly id: string) {}

  static of(id: string): Author {
    const trimmed = id.trim();
    if (trimmed === '') {
      throw new InvalidValue('author id must not be empty');
    }
    return new Author(trimmed);
  }

  equals(other: Author): boolean {
    return this.id === other.id;
  }

  toString(): string {
    return this.id;
  }
}
