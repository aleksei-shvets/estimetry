import type { Card } from '../../domain/card/card.js';
import { similarTasks, typeOf, type SimilarTask } from '../../domain/similarity/similarity.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';
import { otherAuthors } from '../../domain/calibration/other-authors.js';
import { estimateQuery, type EstimateQueryInput } from './estimate-query.js';
import type { AuthorAliases } from './author-aliases.js';
import type { TaskCards } from './task-cards.js';

export const SIMILAR_SCHEMA_VERSION = 1;

export interface SimilarTasksInput extends EstimateQueryInput {
  readonly hours?: number;
  readonly limit?: number;
}

export interface SimilarTaskView {
  readonly id: string;
  readonly title: string;
  readonly score: number;
  readonly matched: SimilarTask['matched'];
  readonly outcome: string;
  /** Type of the first estimate, as calibration counts the task. */
  readonly type: string;
  readonly currentType: string;
  readonly stack: readonly string[];
  readonly spawned: string | null;
  readonly spawnedFrom: string | null;
  readonly firstEstimate: { readonly likelyHours: number; readonly baseLikelyHours: number } | null;
  readonly currentEstimate: { readonly likelyHours: number; readonly baseLikelyHours: number } | null;
  readonly fact: { readonly totalMinutes: number; readonly countedMinutes: number };
  /** As the main ratio of calibration; null with the reason in `excluded`, or without an estimate. */
  readonly ratio: number | null;
  readonly excluded: string | null;
  readonly revisions: { readonly count: number; readonly categories: readonly string[] };
  readonly extras: Readonly<Record<string, { readonly count: number; readonly minutes: number }>>;
  readonly parts: readonly {
    readonly kind: string;
    readonly name: string;
    readonly likelyHours: number;
    readonly factMinutes: number | null;
    /** Only for a part alone in its group, as calibration counts parts. */
    readonly ratio: number | null;
    readonly soleInGroup: boolean;
  }[];
  readonly unfinishedGroups: number;
  readonly retro: { readonly lesson: string; readonly reasons: readonly string[] } | null;
  readonly accuracy: { readonly manualOnly: boolean; readonly uncertain: boolean; readonly backgroundAgents: boolean };
}

export interface SimilarTasksView {
  readonly schemaVersion: number;
  readonly query: { readonly type: string | null; readonly stack: readonly string[]; readonly hours: number | null };
  readonly tasks: readonly SimilarTaskView[];
  /** Cards written by a newer estimetry: not compared. */
  readonly skipped: readonly string[];
  /** Cards of authors other than the current one and its aliases. */
  readonly otherAuthors: number;
}

/** `emt similar` (similar-tasks spec): closed tasks of the author like the new one. */
export class FindSimilarTasks {
  constructor(
    private readonly cards: Pick<TaskCards, 'allCards'>,
    private readonly project: Pick<ResolveCurrentProject, 'find'>,
    private readonly authors: AuthorAliases,
    private readonly taskTypes: TaskTypeCatalog,
  ) {}

  execute(input: SimilarTasksInput): SimilarTasksView {
    const query = estimateQuery(input, this.project, this.taskTypes);
    if (query.type === undefined && query.stack.isEmpty) {
      throw new InvalidValue('nothing to compare by: give --type <type> or --stack <labels>');
    }
    const { cards, skipped } = this.cards.allCards();
    const author = this.authors.current();
    const aliases = this.authors.toCurrent();
    const found = similarTasks(cards, {
      author,
      aliases,
      stack: query.stack,
      ...(query.type === undefined ? {} : { type: query.type.value }),
      ...(input.hours === undefined ? {} : { hours: input.hours }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    return {
      schemaVersion: SIMILAR_SCHEMA_VERSION,
      query: { type: query.type?.value ?? null, stack: [...query.stack.values], hours: input.hours ?? null },
      tasks: found.map(view),
      skipped,
      otherAuthors: otherAuthors(cards, author, aliases),
    };
  }
}

function view(found: SimilarTask): SimilarTaskView {
  const card = found.card;
  const estimateOf = (estimate: Card['estimate']) =>
    estimate === null ? null : { likelyHours: estimate.likelyHours, baseLikelyHours: estimate.baseLikelyHours };
  const coefficient = card.currentEstimate?.coefficient ?? 1;
  const extras: Record<string, { count: number; minutes: number }> = {};
  for (const [category, tally] of Object.entries(card.extras)) {
    const count = tally.absorbed.count + tally.renegotiated.count;
    if (count > 0) {
      extras[category] = { count, minutes: tally.absorbed.minutes + tally.renegotiated.minutes };
    }
  }
  const retro = card.text.retro;
  return {
    id: card.task.id,
    title: card.text.title,
    score: found.score,
    matched: found.matched,
    outcome: card.outcome,
    type: typeOf(card),
    currentType: card.currentEstimate?.type ?? card.task.type,
    stack: card.task.stack,
    spawned: card.task.spawned ?? null,
    spawnedFrom: card.task.spawnedFrom ?? null,
    firstEstimate: estimateOf(card.estimate),
    currentEstimate: estimateOf(card.currentEstimate),
    fact: { totalMinutes: card.fact.totalMinutes, countedMinutes: card.fact.counted.totalMinutes },
    ratio: found.ratio !== undefined && 'ratio' in found.ratio ? Math.round(found.ratio.ratio * 1000) / 1000 : null,
    excluded: found.ratio !== undefined && 'excluded' in found.ratio ? found.ratio.excluded : null,
    revisions: { count: card.revisions.length, categories: card.revisions.flatMap((r) => (r.category === undefined ? [] : [r.category])) },
    extras,
    parts: card.currentParts.map((part, i) => {
      const base = part.likelyHours / coefficient;
      // A part sharing its group got a share of the group's time: its ratio would only repeat the group's.
      const own = part.soleInGroup && part.factMinutes !== null && base > 0;
      return {
        kind: part.kind,
        name: card.text.currentParts[i]?.name ?? `part ${i}`,
        likelyHours: part.likelyHours,
        factMinutes: part.factMinutes,
        ratio: own ? Math.round(((part.factMinutes as number) / 60 / base) * 1000) / 1000 : null,
        soleInGroup: part.soleInGroup,
      };
    }),
    unfinishedGroups: card.plan.unfinishedGroups,
    retro: retro === undefined ? null : { lesson: retro.lesson, reasons: retro.reasons.map((reason) => reason.text) },
    accuracy: {
      manualOnly: card.accuracy === 'minimal',
      uncertain: (card.fact.uncertaintyShare ?? 0) > 0.05,
      backgroundAgents: card.backgroundAgents,
    },
  };
}
