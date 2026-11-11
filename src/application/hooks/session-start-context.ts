import type { SessionId } from '../../domain/measurement/session-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Checkpoints } from './checkpoints.js';
import { cut, MAX_CONTEXT_LENGTH } from './context-limit.js';
import { ESTIMATE_REMINDER, EXTRA_REMINDER, sessionStartContext, type TaskFact } from './hook-context.js';
import type { PendingProposal } from './pending-proposal.js';
import type { SessionTaskResult } from './session-task.js';

/** Fact of a task for the status line; loaded only for the session start, where it is needed. */
export interface TaskFacts {
  /** `near` is the working copy of the session. */
  fact(task: string, near?: string): TaskFact | undefined;
}

/** The context a session start gives the agent: the reminder of estimate mode, a proposal to close, the status line. */
export class SessionStartContext {
  constructor(
    private readonly facts: () => Promise<TaskFacts>,
    private readonly checkpoints: Pick<Checkpoints, 'takeReminder'>,
    private readonly proposal: Pick<PendingProposal, 'take'>,
  ) {}

  async text(session: SessionId, resolved: SessionTaskResult, now: Timestamp): Promise<string> {
    const task = resolved.task;
    const fact = task === undefined ? undefined : (await this.facts()).fact(task.id, resolved.project.root);
    const reminder = this.checkpoints.takeReminder(session);
    const proposal = task === undefined ? undefined : await this.proposal.take(task.id, session, resolved.project.root, now);
    // The reminder of estimate mode and a proposal go first; the status line gets what is left of the limit.
    const before = [ESTIMATE_REMINDER, ...(proposal === undefined ? [] : [proposal])].join('\n').length + 1;
    const status = sessionStartContext({
      budget: MAX_CONTEXT_LENGTH - before,
      session,
      ...(task === undefined ? {} : { task }),
      ...(fact === undefined ? {} : { fact }),
      candidates: resolved.candidates,
    });
    // The reminder of estimate mode goes first, so the length limit never cuts it.
    const lines = [ESTIMATE_REMINDER, ...(proposal === undefined ? [] : [proposal]), status, ...(reminder && task === undefined ? [EXTRA_REMINDER] : [])];
    return cut(lines.join('\n'));
  }
}
