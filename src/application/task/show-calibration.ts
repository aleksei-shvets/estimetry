import { applicableCoefficient, type ApplicableCoefficient } from '../../domain/calibration/applicable-coefficient.js';
import { calibrate, normalized, type AuthorCalibration, type RatioSlices, type RatioStats, type RevisedStats } from '../../domain/calibration/calibration.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { AuthorProvider } from '../ports/author-provider.js';
import type { CalibrationSettings } from '../ports/calibration-settings.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';
import { otherAuthors } from '../../domain/calibration/other-authors.js';
import { estimateQuery, type EstimateQueryInput } from './estimate-query.js';
import type { TaskCards } from './task-cards.js';

export const CALIBRATION_VIEW_SCHEMA_VERSION = 1;

export interface CalibrationInput extends EstimateQueryInput {
  /** For a revision of a task in progress: the coefficient comes from the `revised` slice. */
  readonly revise?: boolean;
}

export interface CalibrationView {
  readonly schemaVersion: number;
  readonly query: { readonly type: string | null; readonly stack: readonly string[]; readonly revise: boolean };
  /** What the hours of every part may be multiplied by; null — without calibration. */
  readonly coefficient: ApplicableCoefficient | null;
  readonly minTasks: number;
  /** Closed tasks of the author, with its aliases. */
  readonly tasks: number;
  readonly ratio: RatioSlices;
  readonly revised: RatioSlices<RevisedStats>;
  readonly revisions: AuthorCalibration['revisions']['byType'][string];
  readonly extras: AuthorCalibration['extras'][string];
  readonly missedScope: AuthorCalibration['missedScope'][string] | null;
  readonly linesPerHour: Readonly<Record<string, AuthorCalibration['linesPerHour']['byStack'][string]>>;
  readonly codeVolume: AuthorCalibration['codeVolume'] | null;
  readonly parts: AuthorCalibration['parts']['byKind'];
  readonly skipped: readonly string[];
  readonly otherAuthors: number;
}

const NO_TASKS: RatioStats = { n: 0, median: null, mean: null, applicable: false, excluded: {}, uncertain: 0, backgroundAgents: 0, revised: 0 };

/**
 * `emt calibrate` (calibration-query spec): the author's coefficients for a
 * type and a stack, computed in memory from the cards; nothing is written.
 */
export class ShowCalibration {
  constructor(
    private readonly cards: Pick<TaskCards, 'allCards' | 'aliases'>,
    private readonly project: Pick<ResolveCurrentProject, 'find'>,
    private readonly authors: AuthorProvider,
    private readonly taskTypes: TaskTypeCatalog,
    private readonly settings: CalibrationSettings,
  ) {}

  execute(input: CalibrationInput): CalibrationView {
    const query = estimateQuery(input, this.project, this.taskTypes);
    const { cards, skipped } = this.cards.allCards();
    const author = this.authors.current().id;
    const aliases = this.cards.aliases();
    const minTasks = this.settings.minTasks();
    // Only the author's section is shown: other authors' cards are not computed at all.
    const own = normalized(cards, aliases).filter((card) => card.author === author);
    const mine = calibrate(own, { minTasks }).authors[author];
    const revise = input.revise === true;
    const pick = <T extends RatioStats>(slices: RatioSlices<T> | undefined, empty: T): RatioSlices<T> => ({
      overall: slices?.overall ?? empty,
      byType: query.type === undefined ? {} : { [query.type]: slices?.byType[query.type] ?? empty },
      byStack: Object.fromEntries(query.stack.map((label) => [label, slices?.byStack[label] ?? empty])),
    });
    const type = query.type;
    return {
      schemaVersion: CALIBRATION_VIEW_SCHEMA_VERSION,
      query: { type: type ?? null, stack: query.stack, revise },
      // A calibration from an incomplete set of cards could give a wrong coefficient.
      coefficient: skipped.length > 0 ? null : applicableCoefficient(mine, { ...(type === undefined ? {} : { type }), stack: query.stack, revise }),
      minTasks,
      tasks: mine?.tasks ?? 0,
      ratio: pick(mine?.ratio, NO_TASKS),
      revised: pick(mine?.revised, { ...NO_TASKS, countedAtShare: null }),
      revisions: type === undefined ? {} : (mine?.revisions.byType[type] ?? {}),
      extras: type === undefined ? {} : (mine?.extras[type] ?? {}),
      missedScope: type === undefined ? null : (mine?.missedScope[type] ?? null),
      linesPerHour: Object.fromEntries(query.stack.flatMap((label) => {
        const stats = mine?.linesPerHour.byStack[label];
        return stats === undefined ? [] : [[label, stats]];
      })),
      codeVolume: mine?.codeVolume ?? null,
      parts: mine?.parts.byKind ?? {},
      skipped,
      otherAuthors: otherAuthors(cards, author, aliases),
    };
  }
}
