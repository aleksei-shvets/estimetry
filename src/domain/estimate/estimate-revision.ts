import { isExtraCategory, type ExtraCategory } from '../measurement/extra.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { Estimate } from './estimate.js';

export const SPENT_POLICIES = ['include', 'exclude'] as const;
/** What a revision does with the time spent before it: it counts, or a window of it was thrown away. */
export type SpentPolicy = (typeof SPENT_POLICIES)[number];

export function isSpentPolicy(value: unknown): value is SpentPolicy {
  return typeof value === 'string' && (SPENT_POLICIES as readonly string[]).includes(value);
}

const MAX_REASON_LENGTH = 500;

/** Why the plan changed: a short summary agreed with the user, never a quote of the conversation. */
export class RevisionReason {
  private constructor(readonly value: string) {}

  static of(text: string): RevisionReason {
    const value = text.trim();
    if (value === '') {
      throw new InvalidValue('a revision needs a reason');
    }
    if (value.length > MAX_REASON_LENGTH) {
      throw new InvalidValue(`the reason of a revision must be at most ${MAX_REASON_LENGTH} characters; give a short summary`);
    }
    return new RevisionReason(value);
  }
}

/** Archived changes of one project when a revision threw work away: they no longer belong to the plan. */
export interface ExcludedArchives {
  readonly project: string;
  /** `changedAt` — when the directory was archived (its ctime, ms), when known. */
  readonly archives: readonly { readonly change: string; readonly archivedOn: string; readonly changedAt?: number }[];
}

/**
 * A new estimate of a task in progress. A task that started without an
 * estimate gets its first one this way, with no category and no `spent`.
 */
export class EstimateRevision {
  private constructor(
    readonly estimate: Estimate,
    readonly type: string | undefined,
    readonly reason: RevisionReason,
    readonly category: ExtraCategory | undefined,
    readonly spent: SpentPolicy | undefined,
    readonly at: Timestamp,
    readonly lostFrom: Timestamp | undefined,
    readonly covers: readonly string[],
    /** With `exclude`: the archive of each project read at the revision; projects absent here were not on this machine. */
    readonly excluded: readonly ExcludedArchives[],
  ) {}

  static of(input: {
    readonly estimate: Estimate;
    readonly type?: string;
    readonly reason: string;
    readonly category?: string;
    readonly spent?: string;
    readonly at: Timestamp;
    readonly lostFrom?: Timestamp;
    readonly covers?: readonly string[];
    readonly excluded?: readonly ExcludedArchives[];
  }): EstimateRevision {
    const category = input.category?.trim().toLowerCase();
    if (category !== undefined && !isExtraCategory(category)) {
      throw new InvalidValue(`unknown category "${input.category}", expected one of: new-requirement, missed-analysis, rework, environment`);
    }
    if (input.spent !== undefined && !isSpentPolicy(input.spent)) {
      throw new InvalidValue(`--spent must be include or exclude, got "${input.spent}"`);
    }
    if (input.lostFrom !== undefined && input.spent !== 'exclude') {
      throw new InvalidValue('--lost-from goes only with --spent exclude: with include nothing is lost');
    }
    const covers = (input.covers ?? []).map((id) => id.trim());
    if (covers.some((id) => id === '')) {
      throw new InvalidValue('--covers needs ids of extra work');
    }
    return new EstimateRevision(
      input.estimate,
      input.type,
      RevisionReason.of(input.reason),
      category as ExtraCategory | undefined,
      input.spent as SpentPolicy | undefined,
      input.at,
      input.lostFrom,
      [...new Set(covers)],
      input.spent === 'exclude' ? [...(input.excluded ?? [])] : [],
    );
  }
}
