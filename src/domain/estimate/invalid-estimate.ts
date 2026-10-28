import { DomainError } from '../shared/domain-error.js';

export interface EstimateIssue {
  /** Path to the field in the estimate file, e.g. `parts[3].hours.likely`; empty for the file itself. */
  readonly path: string;
  readonly message: string;
}

/** Every problem found in an estimate, reported at once. */
export class InvalidEstimate extends DomainError {
  readonly code = 'invalid-estimate';

  constructor(
    readonly issues: readonly EstimateIssue[],
    source?: string,
  ) {
    super(
      [
        `invalid estimate${source ? ` ${source}` : ''}:`,
        ...issues.map((issue) => `  ${issue.path === '' ? '' : `${issue.path}: `}${issue.message}`),
      ].join('\n'),
    );
  }
}
