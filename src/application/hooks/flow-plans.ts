import type { ChangeProgress } from '../../domain/progress/progress-records.js';
import type { Flows } from '../contracts/registries.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import type { ProjectFiles } from '../ports/project-files.js';
import type { ProjectPlans } from '../ports/project-plans.js';

/** The plan of the flow named in `.estimetry/config.yaml`; a project without a known flow has no plan. */
export class FlowProjectPlans implements ProjectPlans {
  constructor(
    private readonly config: ProjectConfigFile,
    private readonly flows: Flows,
    private readonly files: ProjectFiles,
  ) {}

  plan(projectRoot: string): readonly ChangeProgress[] | undefined {
    const id = this.config.read(projectRoot).config?.flow;
    const flow = id === undefined ? undefined : this.flows.get(id);
    return flow?.plan(projectRoot, this.files);
  }
}
