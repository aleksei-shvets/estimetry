import type { CalibrationPolicy } from '../../domain/calibration/calibration-policy.js';

/** `config.yaml` settings of calibration: how a slice is weighed, and earlier ids of the author. */
export interface CalibrationSettings {
  /** `calibration.minTasks` and `calibration.shrink`: the sample a slice needs and how it is shrunk to its parent. */
  policy(): CalibrationPolicy;
  /** `author.aliases`: earlier ids of the same author (a changed email); their cards are the author's. */
  authorAliases(): readonly string[];
}
