import { Timestamp } from '../../domain/shared/timestamp.js';
import type { Task } from '../../domain/task/task.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import type { ResolveActiveTask } from './resolve-active-task.js';

/** Records the user may want to name in `--covers`, or should know stay counted. */
export interface RevisionCandidates {
  /** Extra work recorded since the window of lost work began, any category. */
  readonly extras: readonly { readonly id: string; readonly at: string; readonly category: string; readonly description: string; readonly minutes: number | null }[];
  /** Manual time without a moment recorded in the window: it is not taken out. */
  readonly untimedManual: readonly { readonly description: string; readonly minutes: number }[];
}

export interface RevisionCandidatesInput {
  readonly task?: TaskId;
  readonly lostFrom?: Timestamp;
  readonly spent?: string;
}

/** What `--covers` may name and what stays counted, for the confirmation before `emt estimate revise`. */
export class FindRevisionCandidates {
  constructor(
    private readonly activeTask: ResolveActiveTask,
    private readonly meta: EventMetaSource,
  ) {}

  execute(input: RevisionCandidatesInput): RevisionCandidates {
    const task = this.activeTask.inProgress(input.task);
    // The window of lost work starts by default at the latest of the start, the previous revision and the last reopening.
    return revisionCandidatesOf(task, input.spent === 'exclude' ? (input.lostFrom ?? task.lostWindowFloor) : undefined, this.meta.next().at);
  }
}

/** Extra work and untimed manual time recorded between `from` and `now`; nothing without a window. */
export function revisionCandidatesOf(task: Task, from: Timestamp | undefined, now: Timestamp): RevisionCandidates {
  if (from === undefined) {
    return { extras: [], untimedManual: [] };
  }
  const inWindow = (at: string) => {
    const millis = Timestamp.parse(at).toMillis();
    return millis >= from.toMillis() && millis <= now.toMillis();
  };
  return {
    extras: task.extraRecords
      .filter((record) => record.at !== '' && inWindow(record.at))
      .map((record) => ({
        id: record.id,
        at: record.at,
        category: record.extra.category,
        description: record.extra.description,
        minutes: record.extra.time === undefined ? null : Math.round(record.extra.time.minutes),
      })),
    untimedManual: task.manualRecords
      .filter((record) => record.manual.at === undefined && inWindow(record.recordedAt))
      .map((record) => ({ description: record.manual.description, minutes: Math.round(record.manual.duration.minutes) })),
  };
}
