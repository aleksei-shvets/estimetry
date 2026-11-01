import { sep } from 'node:path';
import type { ChangeProgress } from '../../domain/progress/progress-records.js';
import { ProjectId } from '../../domain/project/project-id.js';
import type { ProjectRepository } from '../../domain/project/project-repository.js';
import type { CalendarDate } from '../../domain/shared/calendar-date.js';
import type { Flow } from '../contracts/flow.js';
import type { Flows } from '../contracts/registries.js';
import type { ProjectConfigFile } from '../ports/project-config-file.js';
import type { ProjectFiles } from '../ports/project-files.js';
import type { PlanReadOptions, ProjectPlanReading, ProjectPlans } from '../ports/project-plans.js';

/** The plan of the flow named in `.estimetry/config.yaml`; a project without a known flow has no plan. */
export class FlowProjectPlans implements ProjectPlans {
  constructor(
    private readonly config: ProjectConfigFile,
    private readonly flows: Flows,
    private readonly files: ProjectFiles,
    private readonly projects: Pick<ProjectRepository, 'findById'>,
  ) {}

  plan(projectRoot: string): readonly ChangeProgress[] | undefined {
    return this.flowOf(projectRoot)?.plan(projectRoot, this.files);
  }

  plans(projects: readonly string[], options: PlanReadOptions & { readonly archivedSince?: CalendarDate } = {}): ProjectPlanReading[] {
    return projects.map((project) => this.read(project, options, true));
  }

  archives(projects: readonly string[], options: PlanReadOptions = {}): ProjectPlanReading[] {
    return projects.map((project) => this.read(project, options, false));
  }

  private read(
    project: string,
    options: PlanReadOptions & { readonly archivedSince?: CalendarDate },
    withChanges: boolean,
  ): ProjectPlanReading {
    let id: ProjectId;
    try {
      id = ProjectId.parse(project);
    } catch {
      return { project, unavailable: 'not-on-this-machine' };
    }
    const root = this.rootOf(this.projects.findById(id)?.paths ?? [], options.near);
    if (root === undefined) {
      return { project, unavailable: 'not-on-this-machine' };
    }
    const flowId = this.config.read(root).config?.flow;
    if (flowId === undefined) {
      return { project, root, unavailable: 'no-config' };
    }
    if (flowId === 'none') {
      return { project, root, flow: flowId, unavailable: 'flow-none' };
    }
    const flow = this.flows.get(flowId);
    if (flow === undefined) {
      return { project, root, flow: flowId, unavailable: 'unknown-flow' };
    }
    const since = options.archivedSince;
    return {
      project,
      root,
      flow: flow.id,
      ...(withChanges ? { changes: flow.plan(root, this.files, since === undefined ? {} : { archivedSince: since }) } : {}),
      archived: flow.archived(root, this.files),
    };
  }

  /**
   * The working copy that contains `near`, else the first registered path this
   * machine has: a task may span working copies on other machines.
   */
  private rootOf(paths: readonly string[], near: string | undefined): string | undefined {
    const containing =
      near === undefined ? undefined : paths.filter((path) => near === path || near.startsWith(path.endsWith(sep) ? path : `${path}${sep}`));
    // The deepest match: a worktree may live inside the main working copy.
    const best = containing?.sort((a, b) => b.length - a.length)[0];
    return best ?? paths.find((path) => this.files.isDirectory(path));
  }

  private flowOf(root: string): Flow | undefined {
    const id = this.config.read(root).config?.flow;
    return id === undefined ? undefined : this.flows.get(id);
  }
}
