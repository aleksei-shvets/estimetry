import type { ArchivedChange } from '../ports/project-plans.js';
import type { ProjectFiles } from '../ports/project-files.js';
import type { ProjectPlanReading, ProjectPlans } from '../ports/project-plans.js';
import { nearOf, type WorkingCopy } from './working-copy.js';
import type { ProjectId } from '../../domain/project/project-id.js';

/**
 * Archives of the flow with the time each directory changed: the moment a
 * change was archived. The time is read only when asked for, one stat per
 * directory, so a hook stats only the directories it looks at.
 */
export class ChangeArchives {
  constructor(
    private readonly plans: Pick<ProjectPlans, 'archives'>,
    private readonly files: Pick<ProjectFiles, 'changedAt'>,
  ) {}

  /** `changes` are the changes of the task: they pick the working copy of the task (plan-progress spec). */
  read(projects: readonly ProjectId[], where: WorkingCopy = {}, changes: readonly string[] = []): ProjectPlanReading[] {
    return this.plans.archives(projects, { ...nearOf(where), changes });
  }

  /** When the directory last changed (ms); undefined when it is gone. */
  changedAt(dir: ArchivedChange): number | undefined {
    return this.files.changedAt(dir.path);
  }
}
