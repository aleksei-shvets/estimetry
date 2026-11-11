import { EstimateQuery } from '../../domain/card/estimate-query.js';
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
export function estimateQuery(input: EstimateQueryInput, project: Pick<ResolveCurrentProject, 'find'>, taskTypes: TaskTypeCatalog): EstimateQuery {
  const stack = input.stack ?? project.find()?.stack ?? [];
  return EstimateQuery.of(input.type === undefined ? { stack } : { type: TaskType.of(input.type, taskTypes.allowed()), stack });
}
