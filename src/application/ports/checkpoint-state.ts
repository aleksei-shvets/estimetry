import type { SessionId } from '../../domain/measurement/session-id.js';

/** Per-session state of checkpoints; written without a lock, so two checkpoints in a row are possible. */
export interface CheckpointStatus {
  readonly lastAt?: string;
  readonly reminderPending?: boolean;
  /** A configuration problem was reported for this session already. */
  readonly configReported?: boolean;
  /** Last hook call of the session, to find the active session of a commit. */
  readonly lastSeenAt?: string;
}

export interface CheckpointState {
  read(session: SessionId): CheckpointStatus;
  write(session: SessionId, status: CheckpointStatus): void;
}
