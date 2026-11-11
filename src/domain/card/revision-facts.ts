import { LostWindow } from '../estimate/lost-window.js';
import type { EffortReport } from '../measurement/effort-report.js';
import type { Timestamp } from '../shared/timestamp.js';
import type { TaskRevision } from '../task/task.js';

/** What a revision leaves on the card: the counted fact at its moment and the work it threw away. */
export interface RevisionFact {
  readonly countedAtMinutes: number;
  readonly lostMinutes: number;
}

/** Measurements of the task the facts are taken from; the journal stays behind them. */
export interface RevisionMeasurements {
  /** The fact of the task, with every window of lost work in it. */
  readonly report: EffortReport;
  /** The counted fact as it stood at a moment. */
  readonly countedAt: (at: Timestamp) => EffortReport;
  /** The fact without one window of lost work. */
  readonly without: (window: LostWindow) => EffortReport;
}

/**
 * Facts of each revision, in order. The lost work is the difference of the
 * facts with and without its window; in parallel mode the sequential
 * equivalent is compared, as the card compares it with the estimate.
 */
export function revisionFacts(revisions: readonly TaskRevision[], measured: RevisionMeasurements): RevisionFact[] {
  const compared = (report: EffortReport) =>
    (report.parallel.used && report.sequentialEquivalent !== undefined ? report.sequentialEquivalent : report.fact).minutes;
  return revisions.map((revision) => {
    const countedAtMinutes = Math.round(measured.countedAt(revision.at).fact.minutes);
    if (revision.spent !== 'exclude' || revision.lostFrom === undefined) {
      return { countedAtMinutes, lostMinutes: 0 };
    }
    const without = measured.without(LostWindow.of(revision.lostFrom, revision.at));
    return { countedAtMinutes, lostMinutes: Math.max(0, Math.round(compared(measured.report) - compared(without))) };
  });
}
