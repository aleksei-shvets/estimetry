import { InvalidValue } from '../shared/domain-error.js';

const PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Id of a session of an AI tool. It becomes part of a file name, so only safe characters pass. */
export class SessionId {
  private constructor(readonly value: string) {}

  static parse(value: string): SessionId {
    if (!PATTERN.test(value)) {
      throw new InvalidValue('invalid session id, expected letters, digits, "-" and "_" (at most 128)');
    }
    return new SessionId(value);
  }

  equals(other: SessionId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
