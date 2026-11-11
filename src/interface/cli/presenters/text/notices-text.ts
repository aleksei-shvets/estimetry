import type { RevisionCandidates } from '../../../../application/task/find-revision-candidates.js';
import type { ManualTimeRecorded } from '../../../../application/task/record-manual-time.js';
import type { TaskView } from '../../../../application/task/task-view.js';
import type { Notices } from '../presenter.js';
import { formatMinutes } from './format.js';

/** Warnings and notes on stderr: for a person, in text whichever presenter prints the result. */
export const textNotices: Notices = {
  taskStarted: (task: TaskView) => (task.estimated ? [] : [`warning: ${task.id} has no estimate, so it will not be used for calibration`]),

  manualTimeRecorded: (recorded: ManualTimeRecorded) =>
    recorded.overlapsMeasured
      ? [
          `warning: the last ${formatMinutes(recorded.minutes)} of ${recorded.task.id} are already partly measured; ` +
            'the record was added on top of them. If it is the same time, record it with --at so it merges instead',
        ]
      : [],

  /** Extra work the revision covers or leaves counted, and untimed manual time that stays. */
  revisionCandidates: (candidates: RevisionCandidates, covers: readonly string[]) => [
    ...candidates.extras.map((extra) => {
      const covered = covers.includes(extra.id);
      return (
        `${covered ? 'covered by this revision' : 'note: not covered (add --covers ' + extra.id + ' if it is the same loss)'}: ` +
        `extra ${extra.category}${extra.minutes === null ? '' : ` ${formatMinutes(extra.minutes)}`} "${extra.description}" [${extra.id}]`
      );
    }),
    ...candidates.untimedManual.map(
      (manual) => `note: manual time without a moment stays counted: ${formatMinutes(manual.minutes)} "${manual.description}"`,
    ),
  ],
};
