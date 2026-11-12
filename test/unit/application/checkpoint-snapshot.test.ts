import { describe, expect, it } from 'vitest';
import { CheckpointSnapshot } from '../../../src/application/hooks/checkpoint-snapshot.js';
import type { ProjectPlans } from '../../../src/application/ports/project-plans.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';

/** Plans, HEAD and the working tree of each root, so the snapshot shows where it was taken. */
function snapshotOf(copies: Record<string, string>) {
  const asked: { near?: string; changes?: readonly string[] }[] = [];
  const plans: Pick<ProjectPlans, 'plan' | 'workingCopy'> = {
    plan: (root) => [{ change: `plan of ${root}`, archived: false, done: 0, total: 1 }],
    workingCopy: (_project, options = {}) => {
      asked.push(options);
      return (options.changes ?? []).map((change) => copies[change]).find((root) => root !== undefined) ?? options.near;
    },
  };
  const git = { head: (root: string) => `head of ${root}`, workingTree: (root: string) => ({ files: [{ path: root, added: 1, deleted: 0 }], untracked: 0 }) };
  return { snapshot: new CheckpointSnapshot(plans, git, git), asked };
}

describe('the content of a checkpoint', () => {
  it('is taken in the working copy of the task: the plan, HEAD and the changes of one copy', () => {
    const { snapshot, asked } = snapshotOf({ auth: '/work/api-wt' });
    const content = snapshot.take({ project: ProjectId.parse('api'), root: '/work/api', changes: ['auth'] });
    expect(asked).toEqual([{ near: '/work/api', changes: ['auth'] }]);
    expect(content.plan?.[0]?.change).toBe('plan of /work/api-wt');
    expect(content.head).toBe('head of /work/api-wt');
    expect(content.workingTree?.files[0]?.path).toBe('/work/api-wt');
  });

  it('stays in the copy of the session when no copy holds a change of the task', () => {
    const { snapshot } = snapshotOf({});
    const content = snapshot.take({ project: ProjectId.parse('api'), root: '/work/api', changes: [] });
    expect(content.head).toBe('head of /work/api');
  });
});
