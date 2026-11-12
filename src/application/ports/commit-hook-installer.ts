import type { EstimetryRunner } from './estimetry-runner.js';
import type { InstallPlan } from './file-change.js';

/** The git `post-commit` hook that reports commits to estimetry. */
export interface CommitHookInstaller {
  installed(projectRoot: string): boolean;
  /**
   * Adds the estimetry block (`enabled`) or removes it. A personal hook (inside `.git` or outside
   * the working copy) runs this installation by `runner` (`estimetryCommand`); a hook the project
   * commits never names paths of this machine.
   */
  plan(projectRoot: string, enabled: boolean, runner?: EstimetryRunner): InstallPlan;
}
