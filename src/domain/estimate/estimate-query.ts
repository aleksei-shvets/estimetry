import type { TaskType } from '../task/task-type.js';
import { stackLabels } from './stack-labels.js';

/** What `emt similar` and `emt calibrate` are asked about: a checked task type and labels of a stack. */
export class EstimateQuery {
  private constructor(
    readonly type: TaskType | undefined,
    readonly stack: readonly string[],
  ) {}

  /** Labels are compared as `stackLabels` gives them. */
  static of(query: { readonly type?: TaskType; readonly stack: readonly string[] }): EstimateQuery {
    return new EstimateQuery(query.type, stackLabels(query.stack));
  }
}
