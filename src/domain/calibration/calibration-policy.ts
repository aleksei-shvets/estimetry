export const DEFAULT_MIN_TASKS = 1;
export const DEFAULT_SHRINK = 2;

/**
 * How calibration weighs a slice (calibration spec): from `calibration.minTasks`
 * tasks a slice has the weight n / (n + k) with k = `calibration.shrink`, and a
 * coefficient is shrunk towards its parent level by it.
 */
export class CalibrationPolicy {
  private constructor(
    readonly minTasks: number,
    readonly shrink: number,
  ) {}

  static readonly DEFAULT = new CalibrationPolicy(DEFAULT_MIN_TASKS, DEFAULT_SHRINK);

  /**
   * The settings of `config.yaml`; an invalid value counts as not given. A
   * threshold chosen without `shrink` means no shrinking: the user who picked
   * the sample a coefficient needs keeps the coefficient they had.
   */
  static fromConfig(given: { readonly minTasks?: number | undefined; readonly shrink?: number | undefined }): CalibrationPolicy {
    const minTasks = given.minTasks !== undefined && Number.isInteger(given.minTasks) && given.minTasks >= 1 ? given.minTasks : undefined;
    const shrink = given.shrink !== undefined && Number.isFinite(given.shrink) && given.shrink >= 0 ? given.shrink : undefined;
    return new CalibrationPolicy(minTasks ?? DEFAULT_MIN_TASKS, shrink ?? (minTasks === undefined ? DEFAULT_SHRINK : 0));
  }

  /** The weight of the observations of a slice of n tasks: 0 below `minTasks`. */
  weight(n: number): number {
    return n < this.minTasks ? 0 : n / (n + this.shrink);
  }
}
