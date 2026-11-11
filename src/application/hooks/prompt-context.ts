import type { SessionId } from '../../domain/measurement/session-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import type { Checkpoints } from './checkpoints.js';
import { cut } from './context-limit.js';
import { EXTRA_REMINDER } from './hook-context.js';
import type { PendingProposal } from './pending-proposal.js';
import type { SessionTaskResult } from './session-task.js';

/** The context a prompt gives the agent, if any: a proposal to close the task and the reminder of extra work. */
export class PromptContext {
  constructor(
    private readonly checkpoints: Pick<Checkpoints, 'takeReminder'>,
    private readonly proposal: Pick<PendingProposal, 'take'>,
  ) {}

  async text(session: SessionId, resolved: SessionTaskResult, now: Timestamp): Promise<string | undefined> {
    const proposal = resolved.task === undefined ? undefined : await this.proposal.take(resolved.task.id, session, resolved.project.root, now);
    const reminder = this.checkpoints.takeReminder(session);
    const lines = [...(proposal === undefined ? [] : [proposal]), ...(reminder ? [EXTRA_REMINDER] : [])];
    return lines.length === 0 ? undefined : cut(lines.join('\n'));
  }
}
