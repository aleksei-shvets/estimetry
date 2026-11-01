import type { IdlePolicy } from '../../domain/measurement/idle-policy.js';

export interface MeasurementSettings {
  /** @throws InvalidValue if the configured threshold is out of range. */
  idlePolicy(): IdlePolicy;
  /** Minutes between checkpoints; out of range gives the default and a `problem` to report once. */
  checkpointInterval(): { readonly minutes: number; readonly problem?: string };
}
