/** `config.yaml` settings of calibration: the sample a coefficient needs, and earlier ids of the author. */
export interface CalibrationSettings {
  /** `calibration.minTasks`: the sample a coefficient needs to be applied. */
  minTasks(): number;
  /** `author.aliases`: earlier ids of the same author (a changed email); their cards are the author's. */
  authorAliases(): readonly string[];
}
