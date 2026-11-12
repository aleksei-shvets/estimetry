import type { SessionId } from '../../domain/measurement/session-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { CloseProposals } from '../ports/close-proposals.js';
import { closeProposalText } from './hook-context.js';
import type { RecentSessions } from './recent-sessions.js';
import type { TaskId } from '../../domain/task/task-id.js';

/** Percent and unfinished groups of a task's plan, for the text of the proposal. */
export interface PlanOfTask {
  of(task: TaskId, near: string): { readonly done?: number; readonly unfinished: readonly string[] };
}

/**
 * The pending proposal to close a task, taken exactly once. The session that
 * noticed the completion gets it first; another one only when that session has
 * been idle longer than the threshold.
 */
export class PendingProposal {
  constructor(
    private readonly proposals: CloseProposals,
    private readonly recent: RecentSessions,
    /** Loaded only when there is a proposal to show. */
    private readonly planOf: () => Promise<PlanOfTask>,
  ) {}

  async take(task: TaskId, session: SessionId, root: string, now: Timestamp): Promise<string | undefined> {
    const pending = this.proposals.peek(task);
    if (pending === undefined) {
      return undefined;
    }
    if (!pending.session.equals(session) && this.recent.isRecent(this.recent.lastSeen(pending.session), now)) {
      return undefined;
    }
    const taken = this.proposals.take(task);
    if (taken === undefined) {
      return undefined;
    }
    let plan: { readonly done?: number; readonly unfinished: readonly string[] } = { unfinished: [] };
    try {
      plan = (await this.planOf()).of(task, root);
    } catch {
      // The proposal goes without the plan rather than not at all.
    }
    return closeProposalText({
      task: task.toString(),
      change: taken.change,
      completedAt: taken.completedAt.toISOString(),
      ...(plan.done === undefined ? {} : { planDone: plan.done }),
      unfinished: plan.unfinished,
    });
  }
}
