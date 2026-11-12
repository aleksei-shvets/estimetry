import type { ChangeProgress } from '../../domain/progress/progress-records.js';
import type { ProjectId } from '../../domain/project/project-id.js';
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

  /** `project` lends the flow of its other copies to a copy without its own config. */
  plan(projectRoot: string, project?: ProjectId): readonly ChangeProgress[] | undefined {
    const copies = this.copiesOf(project === undefined ? [projectRoot] : [projectRoot, ...this.pathsOf(project)]);
    return copies.flowOf(projectRoot)?.plan(projectRoot, this.files);
  }

  plans(projects: readonly ProjectId[], options: PlanReadOptions & { readonly archivedSince?: CalendarDate } = {}): ProjectPlanReading[] {
    return projects.map((project) => this.read(project, options, true));
  }

  archives(projects: readonly ProjectId[], options: PlanReadOptions = {}): ProjectPlanReading[] {
    return projects.map((project) => this.read(project, options, false));
  }

  private read(
    project: ProjectId,
    options: PlanReadOptions & { readonly archivedSince?: CalendarDate },
    withChanges: boolean,
  ): ProjectPlanReading {
    const copies = this.copiesOf(this.pathsOf(project));
    const root = this.choose(copies, options);
    if (root === undefined) {
      return { project, unavailable: 'not-on-this-machine' };
    }
    const flowId = copies.flowIdOf(root);
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
   * The working copy of a task: of the copies that hold a change of the task,
   * the one where the changes moved last if the copies went apart, else the one
   * the work is in, else the first; without such a copy the one the work is in,
   * else the first this machine has (plan-progress spec).
   */
  workingCopy(project: ProjectId, options: PlanReadOptions = {}): string | undefined {
    return this.choose(this.copiesOf(this.pathsOf(project)), options);
  }

  private choose(copies: Copies, options: PlanReadOptions): string | undefined {
    const changes = options.changes ?? [];
    if (copies.paths.length > 1 && changes.length > 0) {
      const touched = copies.paths.flatMap((root) => {
        const touch = copies.flowOf(root)?.touched(root, this.files, changes);
        return touch === undefined ? [] : [{ root, ...touch }];
      });
      const holding = touched.map((copy) => copy.root);
      if (new Set(touched.map((copy) => copy.state)).size > 1) {
        // The copies went apart: the task is kept where its changes moved last. A change proposed
        // on main before the worktree was made is in both copies, and only one of them moves on.
        const latest = Math.max(...touched.map((copy) => copy.at));
        const freshest = touched.filter((copy) => copy.at === latest).map((copy) => copy.root);
        return this.containing(freshest, options.near) ?? freshest[0];
      }
      // The same changes in every copy that has them (a worktree checked out later): the copy of the work.
      if (holding.length > 0) {
        return this.containing(holding, options.near) ?? holding[0];
      }
    }
    return this.containing(copies.paths, options.near) ?? copies.paths[0];
  }

  /** The deepest copy that contains `near`: a worktree may live inside the main working copy. */
  private containing(paths: readonly string[], near: string | undefined): string | undefined {
    if (near === undefined) {
      return undefined;
    }
    return paths.filter((path) => this.files.contains(path, near)).sort((a, b) => b.length - a.length)[0];
  }

  /** The copies of a project this machine has. */
  private pathsOf(project: ProjectId): string[] {
    return (this.projects.findById(project)?.paths ?? []).filter((path) => this.files.isDirectory(path));
  }

  /**
   * Copies with their flows, each config read once: a copy without its own
   * config takes the flow of another copy of the same project. A worktree has
   * no config of its own when the file is not committed.
   */
  private copiesOf(paths: readonly string[]): Copies {
    const own = new Map(paths.map((path) => [path, this.config.read(path)] as const));
    const shared = [...own.values()].find((read) => read.config?.flow !== undefined)?.config?.flow;
    // A broken config is the copy's own and stays broken: only a missing one takes the flow of another copy.
    const flowIdOf = (root: string) => {
      const read = own.get(root);
      return read?.config?.flow ?? (read?.warning === undefined ? shared : undefined);
    };
    return {
      paths: [...own.keys()],
      flowIdOf,
      flowOf: (root) => {
        const id = flowIdOf(root);
        return id === undefined ? undefined : this.flows.get(id);
      },
    };
  }
}

/** The copies of a project on this machine with the flow of each. */
interface Copies {
  readonly paths: readonly string[];
  flowIdOf(root: string): string | undefined;
  flowOf(root: string): Flow | undefined;
}
