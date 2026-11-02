import type { Calibration } from '../../domain/calibration/calibration.js';

/** `calibration.json`, derived from the cards. */
export interface CalibrationStore {
  /**
   * Computes and writes the calibration in one locked step, so two closings at
   * once cannot leave a result built from an incomplete set of cards.
   */
  recalculate(compute: () => Calibration): Calibration;
  read(): Calibration | undefined;
}
