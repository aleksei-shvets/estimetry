import type { EventEnvelope } from '../shared/event-envelope.js';
import type { LogSession } from './session-log.js';

/*
 * Records of progress written next to activity in the journal of a task:
 * checkpoints with snapshots of the plan and of git, and commits. They are not
 * events of the Task aggregate and do not count in its version.
 */

/** Long file lists are cut: the journal stays small, the counts stay exact. */
export const MAX_RECORDED_FILES = 1000;

export interface FileLines {
  readonly path: string;
  /** Null for a binary file. */
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface FileList {
  readonly files: readonly FileLines[];
  /** All files, also those beyond the cut. */
  readonly fileCount: number;
  readonly truncated: boolean;
}

export interface ChangeProgress {
  readonly change: string;
  readonly archived: boolean;
  /** `YYYY-MM-DD` from the name of the archive directory; absent for active changes and in older checkpoints. */
  readonly archivedOn?: string;
  /** When the archive directory last changed (ms), read for the plan of a task: tells a change archived anew from one rolled back. */
  readonly changedAt?: number;
  readonly done: number;
  readonly total: number;
}

export type CheckpointRecorded = EventEnvelope<
  'checkpoint.recorded',
  {
    readonly source: string;
    readonly session: string;
    /** Absent when the plan could not be read; empty for a flow without a plan. */
    readonly plan?: readonly ChangeProgress[];
    readonly head?: string;
    readonly workingTree?: FileList & { readonly untracked: number };
  }
>;

export type CommitRecorded = EventEnvelope<
  'commit.recorded',
  FileList & {
    readonly source: string;
    readonly sha: string;
    readonly parents: readonly string[];
    /** `git patch-id --stable`: the same change after amend, rebase or cherry-pick has the same id. */
    readonly patchId?: string;
    readonly authoredAt: string;
    readonly committedAt: string;
  }
>;

/**
 * A change of the task's plan appeared in the archive. `directory` is the key:
 * a change created again and archived again is a new completion.
 */
export type ChangeCompleted = EventEnvelope<
  'change.completed',
  {
    readonly source: string;
    readonly project: string;
    readonly change: string;
    readonly directory: string;
    readonly flow: string;
    /** When the directory was moved into the archive (its ctime), or its date when that is unknown. */
    readonly completedAt: string;
    readonly detectedAt: string;
    /** True when the moment is not the move itself: a first run on a task, or a ctime older than the start. */
    readonly approximate: boolean;
  }
>;

/** Archive directories that existed before the task, noted on the first run so they never count as completions. */
export type PlanBaseline = EventEnvelope<
  'plan.baseline',
  { readonly source: string; readonly project: string; readonly directories: readonly string[] }
>;

/** The plan of one project of the task in a snapshot; a project not readable here has `unavailable` instead. */
export interface ProjectPlanSnapshot {
  readonly project: string;
  readonly changes?: readonly ChangeProgress[];
  readonly head?: string;
  readonly unavailable?: string;
}

/** The plan when work started: the base the checkboxes closed during the task are counted from. */
export type PlanStarted = EventEnvelope<
  'plan.started',
  { readonly source: string; readonly projects: readonly ProjectPlanSnapshot[] }
>;

/** The plan at a revision: the base the fact by parts of the new estimate counts from. */
export type PlanRevised = EventEnvelope<
  'plan.revised',
  { readonly source: string; readonly revision: string; readonly projects: readonly ProjectPlanSnapshot[] }
>;

/**
 * The plan when the task closed, with what the card needs of it: the card is
 * built from the journal alone, so it never reads `tasks.md`, the archive or
 * the project registry again.
 */
export type PlanClosing = EventEnvelope<
  'plan.closing',
  {
    readonly source: string;
    readonly projects: readonly ProjectPlanSnapshot[];
    /** Percent of the plan done; absent when it cannot be counted. */
    readonly done?: number;
    /** Groups of the estimate whose changes are all completed, and the rest. */
    readonly completedGroups: readonly string[];
    readonly unfinishedGroups: readonly string[];
    /** Stack of the task's projects, for a task without an estimate. */
    readonly stack: readonly string[];
  }
>;

export const CODE_SOURCES = ['commits', 'snapshots', 'unknown'] as const;
export type CodeSource = (typeof CODE_SOURCES)[number];

/** Code volume of one project of the task, measured before closing. */
export interface ProjectCode extends FileList {
  readonly project: string;
  readonly source: CodeSource;
  /** Why the volume is `unknown`, e.g. `base-not-ancestor`, `not-on-this-machine`. */
  readonly reason?: string;
  /** Recorded commits whose reachability could not be checked. */
  readonly unverified?: boolean;
  /** Recorded commits no longer reachable from `HEAD` (amended, rebased, another branch). */
  readonly unreachable?: number;
  /** Commits of the author between the base and `HEAD` that were not recorded; their lines are counted from git. */
  readonly uncovered?: number;
}

/** Changed files of the task by project; the card classifies them on every build, so masks can change later. */
export type CodeMeasured = EventEnvelope<
  'code.measured',
  { readonly source: string; readonly measuredAt: string; readonly projects: readonly ProjectCode[] }
>;

export type ProgressRecord =
  | CheckpointRecorded
  | CommitRecorded
  | ChangeCompleted
  | PlanBaseline
  | PlanStarted
  | PlanRevised
  | PlanClosing
  | CodeMeasured
  | LogSession;
export const PROGRESS_RECORD_TYPES: readonly ProgressRecord['type'][] = [
  'checkpoint.recorded',
  'commit.recorded',
  'change.completed',
  'plan.baseline',
  'plan.started',
  'plan.revised',
  'plan.closing',
  'code.measured',
  'log.session',
];

export function isProgressRecordType(type: unknown): type is ProgressRecord['type'] {
  return typeof type === 'string' && (PROGRESS_RECORD_TYPES as readonly string[]).includes(type);
}

/** Cuts a file list to the limit, keeping the real count. */
export function fileList(files: readonly FileLines[]): FileList {
  return {
    files: files.slice(0, MAX_RECORDED_FILES),
    fileCount: files.length,
    truncated: files.length > MAX_RECORDED_FILES,
  };
}
