import type { Timestamp } from '../../domain/shared/timestamp.js';

export interface Clock {
  now(): Timestamp;
}
