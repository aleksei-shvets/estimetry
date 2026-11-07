import type { Card } from '../../domain/card/card.js';
import { normalized } from '../../domain/calibration/calibration.js';
import { stackLabels } from '../../domain/estimate/stack-labels.js';
import { TaskType } from '../../domain/task/task-type.js';
import type { ResolveCurrentProject } from '../project/resolve-current-project.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';

/** What `emt similar` and `emt calibrate` are asked about. */
export interface EstimateQueryInput {
  readonly type?: string;
  /** Labels of the stack; the stack of the current project when absent. */
  readonly stack?: readonly string[];
}

/** Type checked by the catalog, labels of the stack — given or the current project's. */
export function estimateQuery(
  input: EstimateQueryInput,
  project: Pick<ResolveCurrentProject, 'find'>,
  taskTypes: TaskTypeCatalog,
): { readonly type?: string; readonly stack: readonly string[] } {
  const type = input.type === undefined ? undefined : TaskType.of(input.type, taskTypes.allowed()).value;
  const stack = stackLabels(input.stack ?? project.find()?.stack ?? []);
  return { ...(type === undefined ? {} : { type }), stack };
}

export function otherAuthors(cards: readonly Card[], author: string, aliases: ReadonlyMap<string, string>): number {
  return normalized(cards, aliases).filter((card) => card.author !== author).length;
}
