import type { EventJournal } from '../../application/ports/event-journal.js';
import { isActivityEventType, parseActivityEvent, type ActivityEvent } from '../../domain/measurement/activity-events.js';
import { TaskId } from '../../domain/task/task-id.js';
import { appendJsonLine, readJsonLines } from '../fs/jsonl.js';
import type { StorageLayout } from '../fs/storage-layout.js';

/**
 * Activity events in `events/<task>.jsonl`, next to the aggregate's events.
 * Appends take no lock and never change the task version: hooks must be fast,
 * and an append of a single line is atomic on its own.
 */
export class JsonlEventJournal implements EventJournal {
  constructor(private readonly layout: StorageLayout) {}

  append(event: ActivityEvent): void {
    const valid = parseActivityEvent(event);
    appendJsonLine(this.layout.taskJournal(TaskId.parse(valid.task).toString()), valid);
  }

  readActivity(task: TaskId): ActivityEvent[] {
    const events: ActivityEvent[] = [];
    for (const record of readJsonLines(this.layout.taskJournal(task.toString()))) {
      const type = (record as { type?: unknown } | null)?.type;
      if (!isActivityEventType(type)) {
        continue; // an event of the aggregate, or something unknown
      }
      try {
        events.push(parseActivityEvent(record));
      } catch {
        // A record that breaks the contract is skipped; the fact is computed from the rest.
      }
    }
    return events;
  }
}
