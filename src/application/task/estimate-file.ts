import type { Estimate } from '../../domain/estimate/estimate.js';
import { TaskType } from '../../domain/task/task-type.js';
import type { EstimateReader } from '../ports/estimate-reader.js';
import type { TaskTypeCatalog } from '../ports/task-type-catalog.js';

/** An estimate file with its task type checked by the catalog. */
export class EstimateFile {
  constructor(
    private readonly reader: EstimateReader,
    private readonly taskTypes: TaskTypeCatalog,
  ) {}

  /** @throws InvalidEstimate for a broken file, InvalidValue for a type not in the catalog. */
  read(file: string): { readonly estimate: Estimate; readonly type?: TaskType } {
    const estimate = this.reader.read(file);
    return estimate.type === undefined ? { estimate } : { estimate, type: TaskType.of(estimate.type, this.taskTypes.allowed()) };
  }
}
