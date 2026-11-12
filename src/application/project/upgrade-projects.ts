import type { InstallCopy, PlannedFile } from './install-copy.js';
import type { SkippedCopy, UpgradePlanner } from './upgrade-plan.js';

/** One working copy in the result of `upgrade`: the files that changed. */
export interface UpgradedCopy {
  readonly project: string;
  readonly root: string;
  readonly files: readonly PlannedFile[];
  readonly warnings: readonly string[];
}

export interface UpgradeReport {
  readonly version: string;
  /** The copies installed again, with the files that changed. */
  readonly upgraded: readonly UpgradedCopy[];
  /** Copies left alone, and why. */
  readonly skipped: readonly SkippedCopy[];
  /** Copies that failed while writing: some of their files may be new already, their version is not recorded. */
  readonly failed: readonly SkippedCopy[];
}

/**
 * `emt upgrade` after the user agreed (project-init spec): installs estimetry
 * again into every set-up copy, each with its own choices, and records the version.
 * A copy that fails does not stop the others.
 */
export class UpgradeProjects {
  constructor(
    private readonly planner: Pick<UpgradePlanner, 'plan'>,
    private readonly install: Pick<InstallCopy, 'apply'>,
  ) {}

  execute(): UpgradeReport {
    const { version, copies, skipped } = this.planner.plan();
    const upgraded: UpgradedCopy[] = [];
    const failed: SkippedCopy[] = [];
    for (const copy of copies) {
      try {
        this.install.apply(copy.plan);
        upgraded.push({ project: copy.project, root: copy.root, files: copy.files, warnings: copy.warnings });
      } catch (error) {
        failed.push({ project: copy.project, root: copy.root, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { version, upgraded, skipped, failed };
  }
}
