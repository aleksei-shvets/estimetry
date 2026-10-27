/**
 * Base class for violations of domain rules. The interface layer maps these to
 * user-facing errors; anything that is not a DomainError is treated as a bug.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidValue extends DomainError {
  readonly code = 'invalid-value';
}
