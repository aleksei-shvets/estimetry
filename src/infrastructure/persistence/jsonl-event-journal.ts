import { renameSync, statSync } from 'node:fs';
import type { EventJournal } from '../../application/ports/event-journal.js';
import { isActivityEventType, parseActivityEvent, type ActivityEvent } from '../../domain/measurement/activity-events.js';
import { parseProgressRecord } from '../../domain/progress/progress-record-parser.js';
import { isProgressRecordType, type ProgressRecord } from '../../domain/progress/progress-records.js';
import { ProjectId } from '../../domain/project/project-id.js';
import { TaskId } from '../../domain/task/task-id.js';
import { appendJsonLine, readJsonLines } from '../fs/jsonl.js';
import type { StorageLayout } from '../fs/storage-layout.js';

/** Sessions of projects without a task in progress record everything; the file is rotated past this size. */
export const UNASSIGNED_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * Activity events and progress records in `events/<task>.jsonl`, next to the
 * aggregate's events, and in `events/unassigned/<project>.jsonl` for sessions
 * without a task. Appends take no lock and never change the task version:
 * hooks must be fast, and an append of a single line is atomic on its own.
 */
export class JsonlEventJournal implements EventJournal {
  constructor(
    private readonly layout: StorageLayout,
    private readonly unassignedLimitBytes = UNASSIGNED_LIMIT_BYTES,
  ) {}

  append(event: ActivityEvent): void {
    const valid = parseActivityEvent(event);
    appendJsonLine(this.layout.taskJournal(TaskId.parse(valid.task).toString()), valid);
  }

  readActivity(task: TaskId): ActivityEvent[] {
    return this.read(this.layout.taskJournal(task.toString()), isActivityEventType, (record) => parseActivityEvent(record));
  }

  appendRecord(record: ProgressRecord): void {
    const valid = parseProgressRecord(record);
    appendJsonLine(this.layout.taskJournal(TaskId.parse(valid.task).toString()), valid);
  }

  readRecords(task: TaskId): ProgressRecord[] {
    return this.read(this.layout.taskJournal(task.toString()), isProgressRecordType, (record) => parseProgressRecord(record));
  }

  readAll(task: TaskId): { activity: ActivityEvent[]; records: ProgressRecord[] } {
    const activity: ActivityEvent[] = [];
    const records: ProgressRecord[] = [];
    for (const record of readJsonLines(this.layout.taskJournal(task.toString()))) {
      const type = (record as { type?: unknown } | null)?.type;
      try {
        if (isActivityEventType(type)) {
          activity.push(parseActivityEvent(record));
        } else if (isProgressRecordType(type)) {
          records.push(parseProgressRecord(record));
        }
      } catch {
        // Skipped like in the separate reads.
      }
    }
    return { activity, records };
  }

  appendUnassigned(project: string, entry: ActivityEvent | ProgressRecord): void {
    const valid = isProgressRecordType(entry.type)
      ? parseProgressRecord(entry, { withoutTask: true })
      : parseActivityEvent(entry, { withoutTask: true });
    const file = this.layout.unassignedJournal(ProjectId.parse(project).value);
    this.rotate(file);
    appendJsonLine(file, valid);
  }

  readUnassigned(project: string): ActivityEvent[] {
    return this.read(this.layout.unassignedJournal(ProjectId.parse(project).value), isActivityEventType, (record) =>
      parseActivityEvent(record, { withoutTask: true }),
    );
  }

  private read<T>(file: string, matches: (type: unknown) => boolean, parse: (record: unknown) => T): T[] {
    const entries: T[] = [];
    for (const record of readJsonLines(file)) {
      if (!matches((record as { type?: unknown } | null)?.type)) {
        continue; // an event of the aggregate, another kind of record, or something unknown
      }
      try {
        entries.push(parse(record));
      } catch {
        // A record that breaks the contract is skipped; the fact is computed from the rest.
      }
    }
    return entries;
  }

  /** Past the limit the journal becomes `<project>.1.jsonl`, replacing the previous one. */
  private rotate(file: string): void {
    try {
      if (statSync(file).size > this.unassignedLimitBytes) {
        renameSync(file, file.replace(/\.jsonl$/, '.1.jsonl'));
      }
    } catch {
      // No journal yet.
    }
  }
}
