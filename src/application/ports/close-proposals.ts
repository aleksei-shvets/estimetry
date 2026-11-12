import type { SessionId } from '../../domain/measurement/session-id.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';
/** A change of the task was completed: the agent should ask whether to close the task. */
export interface CloseProposal {
  readonly change: string;
  /** The project of the change; absent in proposals written before it was recorded. */
  readonly project?: ProjectId;
  readonly completedAt: Timestamp;
  /** The session the completion was noticed in; it gets the proposal first. */
  readonly session: SessionId;
}

/** `progress/<task>.proposal.yaml`: one pending proposal per task, handed out exactly once. */
export interface CloseProposals {
  /** Replaces a pending proposal: the latest completion is the one to ask about. */
  put(task: TaskId, proposal: CloseProposal): void;
  peek(task: TaskId): CloseProposal | undefined;
  /** Takes the proposal atomically; undefined when there is none or another hook took it first. */
  take(task: TaskId): CloseProposal | undefined;
  remove(task: TaskId): void;
}
