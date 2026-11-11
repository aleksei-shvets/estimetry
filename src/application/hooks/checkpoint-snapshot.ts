import { fileList, type CheckpointRecorded } from '../../domain/progress/progress-records.js';
import type { GitHead, GitSnapshots } from '../ports/git-snapshot.js';
import type { ProjectPlans } from '../ports/project-plans.js';

/** What a checkpoint holds besides its session. */
export type CheckpointContent = Pick<CheckpointRecorded['data'], 'plan' | 'head' | 'workingTree'>;

/** The content of a checkpoint (checkpoints spec): the plan, `HEAD` and the working tree of a project. */
export class CheckpointSnapshot {
  constructor(
    private readonly plans: Pick<ProjectPlans, 'plan'>,
    private readonly head: GitHead,
    private readonly git: Pick<GitSnapshots, 'workingTree'>,
  ) {}

  /** A part that fails stays empty; the rest is still taken. */
  take(root: string): CheckpointContent {
    const plan = attempt(() => this.plans.plan(root));
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
