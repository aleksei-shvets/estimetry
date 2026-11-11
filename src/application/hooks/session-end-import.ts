import type { SessionId } from '../../domain/measurement/session-id.js';
import { isInProgress } from '../../domain/task/task-status.js';
import { servedTasks, type SessionBindings } from '../ports/session-bindings.js';
import type { TaskStatusReader } from '../ports/task-status-reader.js';
import type { ImportSessionLogs } from '../task/import-session-logs.js';

/** The session end imports the session's log in the hook itself, within this time (claude-code-hooks spec). */
export const SESSION_END_IMPORT_BUDGET_MS = 5_000;

/**
 * The log of an ended session goes into every task in progress it served.
 * Past the budget the import gives up; the closing of the task catches up.
 */
export class SessionEndImport {
  constructor(
    private readonly bindings: SessionBindings,
    private readonly tasks: TaskStatusReader,
    /** The importer of session logs; loaded on the session end only, absent where logs are not imported. */
    private readonly logs?: () => Promise<Pick<ImportSessionLogs, 'execute'>>,
  ) {}

  async run(source: string, session: SessionId, transcript: string | undefined): Promise<void> {
    if (this.logs === undefined) {
      return;
    }
    const binding = this.bindings.get(session);
    const tasks = servedTasks(binding).flatMap((id) => {
      const summary = this.tasks.summary(id);
      return summary !== undefined && isInProgress(summary.status) ? [{ id, project: summary.projects[0] ?? binding?.project ?? '' }] : [];
    });
    if (tasks.length === 0) {
      return;
    }
    const path = transcript ?? binding?.transcript;
    (await this.logs()).execute({
      session: session.value,
      source,
      ...(path === undefined ? {} : { path }),
      tasks,
      budgetMs: SESSION_END_IMPORT_BUDGET_MS,
    });
  }
}
