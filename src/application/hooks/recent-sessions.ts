import type { SessionId } from '../../domain/measurement/session-id.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { CheckpointState } from '../ports/checkpoint-state.js';
import type { MeasurementSettings } from '../ports/measurement-settings.js';

/** When sessions were last seen, from their checkpoint state: whose session is active now. */
export class RecentSessions {
  constructor(
    private readonly state: Pick<CheckpointState, 'read'>,
    private readonly settings: Pick<MeasurementSettings, 'idlePolicy'>,
  ) {}

  /** Milliseconds; undefined for a session never seen or a state that cannot be read. */
  lastSeen(session: SessionId): number | undefined {
    try {
      const seen = this.state.read(session).lastSeenAt;
      return seen === undefined ? undefined : Timestamp.parse(seen).toMillis();
    } catch {
      return undefined;
    }
  }

  /** Seen within the idle threshold before `now`. */
  isRecent(seen: number | undefined, now: Timestamp): seen is number {
    return seen !== undefined && now.toMillis() - seen <= this.settings.idlePolicy().threshold.millis;
  }
}
