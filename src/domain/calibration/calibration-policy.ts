export const DEFAULT_MIN_TASKS = 1;
export const DEFAULT_SHRINK = 2;

/**
 * How calibration weighs a slice (calibration spec): from `calibration.minTasks`
 * tasks a slice has the weight n / (n + k) with k = `calibration.shrink` and is a
 * level of the coefficient; each level is shrunk towards the one above by the
 * weight of its own tasks (`partWeight`).
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
    return n < this.minTasks ? 0 : this.partWeight(n);
  }

  /**
   * The weight of the own tasks of a level in the chain, n / (n + k), without
   * the threshold: `minTasks` is checked on the whole slice. 0 without tasks.
   */
  partWeight(n: number): number {
    return n === 0 ? 0 : n / (n + this.shrink);
  }
}
