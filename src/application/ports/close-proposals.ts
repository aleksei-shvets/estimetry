/** A change of the task was completed: the agent should ask whether to close the task. */
export interface CloseProposal {
  readonly change: string;
  /** The project of the change; absent in proposals written before it was recorded. */
  readonly project?: string;
  readonly completedAt: string;
  /** The session the completion was noticed in; it gets the proposal first. */
  readonly session: string;
}

/** `progress/<task>.proposal.yaml`: one pending proposal per task, handed out exactly once. */
export interface CloseProposals {
  /** Replaces a pending proposal: the latest completion is the one to ask about. */
  put(task: string, proposal: CloseProposal): void;
  peek(task: string): CloseProposal | undefined;
  /** Takes the proposal atomically; undefined when there is none or another hook took it first. */
  take(task: string): CloseProposal | undefined;
  remove(task: string): void;
}
