import type { Estimate } from '../../domain/estimate/estimate.js';

export interface EstimateReader {
  /** @throws InvalidEstimate listing every problem in the file at once. */
  read(file: string): Estimate;
}
