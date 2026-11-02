import { DomainError } from '../shared/domain-error.js';

/** A card written by a newer estimetry: calibration from the rest would be built on an incomplete set. */
export class CardsTooNew extends DomainError {
  readonly code = 'cards-too-new';

  constructor(tasks: readonly string[]) {
    super(
      `the cards of ${tasks.join(', ')} were written by a newer version of estimetry; calibration.json is left as it was — update estimetry`,
    );
  }
}
