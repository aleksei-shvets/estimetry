import { fileList, type CheckpointRecorded } from '../../domain/progress/progress-records.js';
import type { GitHead, GitSnapshots } from '../ports/git-snapshot.js';
import type { ProjectPlans } from '../ports/project-plans.js';
import type { ProjectId } from '../../domain/project/project-id.js';

/** What a checkpoint holds besides its session. */
export type CheckpointContent = Pick<CheckpointRecorded['data'], 'plan' | 'head' | 'workingTree'>;

/** Where the checkpoint of a task is asked from: the project and copy of the session, and the changes of the task. */
export interface CheckpointPlace {
  readonly project: ProjectId;
  readonly root: string;
  readonly changes: readonly string[];
}

/** The content of a checkpoint (checkpoints spec): the plan, `HEAD` and the working tree of a project. */
export class CheckpointSnapshot {
  constructor(
    private readonly plans: Pick<ProjectPlans, 'plan' | 'workingCopy'>,
    private readonly head: GitHead,
    private readonly git: Pick<GitSnapshots, 'workingTree'>,
  ) {}

  /**
   * Taken in the working copy of the task, which may not be the copy of the
   * session (a task in a worktree, the session in the main copy). A part that
   * fails stays empty; the rest is still taken.
   */
  take(where: CheckpointPlace): CheckpointContent {
    const root = attempt(() => this.plans.workingCopy(where.project, { near: where.root, changes: where.changes })) ?? where.root;
    const plan = attempt(() => this.plans.plan(root, where.project));
    const head = attempt(() => this.head.head(root));
    const tree = head === undefined ? undefined : attempt(() => this.git.workingTree(root));
    return {
      ...(plan === undefined ? {} : { plan }),
      ...(head === undefined ? {} : { head }),
      ...(tree === undefined ? {} : { workingTree: { ...fileList(tree.files), untracked: tree.untracked } }),
    };
  }
}

function attempt<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
