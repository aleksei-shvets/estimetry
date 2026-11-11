import { StackLabels } from '../estimate/stack-labels.js';
import type { TaskType } from '../task/task-type.js';

/**
 * What `emt similar` and `emt calibrate` ask the cards of closed tasks about:
 * a checked task type and labels of a stack.
 */
export class EstimateQuery {
  private constructor(
    readonly type: TaskType | undefined,
    readonly stack: StackLabels,
  ) {}

  static of(query: { readonly type?: TaskType; readonly stack: readonly string[] }): EstimateQuery {
    return new EstimateQuery(query.type, StackLabels.of(query.stack));
  }
}
