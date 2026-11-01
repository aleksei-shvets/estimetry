import type { ChangeProgress } from '../../domain/progress/progress-records.js';

/** The plan of a project's flow (from `.estimetry/config.yaml`); undefined when it cannot be read. */
export interface ProjectPlans {
  plan(projectRoot: string): readonly ChangeProgress[] | undefined;
}
