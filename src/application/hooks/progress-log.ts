import type { ProgressRecord } from '../../domain/progress/progress-records.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { ProgressSeen, ProgressState } from '../ports/progress-state.js';

/**
 * Directories of the archive already noticed for a task (plan-progress
 * spec). The journal is the source of truth; the cache `progress/<task>.yaml`
 * only spares reading it and is rebuilt from it when lost.
 */
export class ProgressLog {
  constructor(
    private readonly state: ProgressState,
    private readonly journal: Pick<EventJournal, 'appendRecord' | 'readRecords'>,
  ) {}

  /** What was noticed; `cached` is false when it came from the journal and the cache is to be written. */
  seen(task: TaskId): { readonly seen: ProgressSeen; readonly cached: boolean } {
    const cached = this.state.read(task);
    return cached === undefined
      ? { seen: fromRecords(this.journal.readRecords(task)), cached: false }
      : { seen: cached, cached: true };
  }

  /** Journal first, then the cache: a crash in between repeats a record, it never loses one. */
  record(task: TaskId, records: readonly ProgressRecord[], seen: ProgressSeen | undefined): void {
    for (const record of records) {
      this.journal.appendRecord(record);
    }
    if (seen !== undefined) {
      this.state.write(task, seen);
    }
  }
}

/** The cache rebuilt from the journal: directories of completions and baselines, by project. */
function fromRecords(records: readonly ProgressRecord[]): ProgressSeen {
  const directories: Record<string, string[]> = {};
  for (const record of records) {
    if (record.type === 'plan.baseline') {
      (directories[record.data.project] ??= []).push(...record.data.directories);
    } else if (record.type === 'change.completed') {
      (directories[record.data.project] ??= []).push(record.data.directory);
    }
  }
  return { directories };
}
