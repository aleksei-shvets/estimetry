import type { Clock } from '../../application/ports/clock.js';
import { Timestamp } from '../../domain/shared/timestamp.js';

export class SystemClock implements Clock {
  now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
}
