import type { SessionId } from '../../domain/measurement/session-id.js';
import { isInProgress } from '../../domain/task/task-status.js';
import { servedTasks, type SessionBindings } from '../ports/session-bindings.js';
import type { HookAdapter } from '../contracts/hook-adapter.js';
import type { TaskStatusReader } from '../ports/task-status-reader.js';
import type { ImportSessionLogs } from '../task/import-session-logs.js';

/**
 * The log of an ended session goes into every task in progress it served, in the hook itself, within the budget
 * of the tool (it waits for the session end hook only so long). Past it the import gives up; the closing of the task
 * catches up.
 */
export class SessionEndImport {
  constructor(
    private readonly bindings: SessionBindings,
    private readonly tasks: TaskStatusReader,
    /** The importer of session logs; loaded on the session end only, absent where logs are not imported. */
    private readonly logs?: () => Promise<Pick<ImportSessionLogs, 'execute'>>,
  ) {}

  async run(tool: Pick<HookAdapter, 'id' | 'sessionEndBudgetMs'>, session: SessionId, transcript: string | undefined): Promise<void> {
    if (this.logs === undefined) {
      return;
    }
    const binding = this.bindings.get(session);
    const tasks = servedTasks(binding).flatMap((id) => {
      const summary = this.tasks.summary(id);
      const project = summary?.projects[0] ?? binding?.project;
      return summary !== undefined && isInProgress(summary.status) && project !== undefined ? [{ id, project }] : [];
    });
    if (tasks.length === 0) {
      return;
    }
    const path = transcript ?? binding?.transcript;
    (await this.logs()).execute({
      session,
      source: tool.id,
      ...(path === undefined ? {} : { path }),
      tasks,
      budgetMs: tool.sessionEndBudgetMs,
    });
  }
}
