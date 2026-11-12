import type { UpgradePlanner } from './upgrade-plan.js';
import type { PlannedFile } from './install-copy.js';

/** What `emt upgrade` asks the user about: the copies, the files that change, the copies skipped. */
export interface UpgradePlanView {
  readonly version: string;
  readonly copies: readonly {
    readonly project: string;
    readonly root: string;
    readonly installedBy?: string;
    readonly shared: boolean;
    readonly files: readonly PlannedFile[];
    readonly warnings: readonly string[];
  }[];
  readonly skipped: readonly { readonly project: string; readonly root: string; readonly reason: string }[];
}

/** The plan of `emt upgrade`, written nowhere (project-init spec). */
export class ShowUpgradePlan {
  constructor(private readonly planner: Pick<UpgradePlanner, 'plan'>) {}

  execute(): UpgradePlanView {
    const { version, copies, skipped } = this.planner.plan();
    return {
      version,
      copies: copies.map(({ project, root, installedBy, shared, files, warnings }) => ({
        project,
        root,
        ...(installedBy === undefined ? {} : { installedBy }),
        shared,
        files,
        warnings,
      })),
      skipped,
    };
  }
}
