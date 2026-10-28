import type { IdlePolicy } from '../../domain/measurement/idle-policy.js';

export interface MeasurementSettings {
  /** @throws InvalidValue if the configured threshold is out of range. */
  idlePolicy(): IdlePolicy;
}
