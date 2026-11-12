import type { InstallPlan } from './file-change.js';

/** The git `post-commit` hook that reports commits to estimetry. */
export interface CommitHookInstaller {
  installed(projectRoot: string): boolean;
  /**
   * Adds the estimetry block (`enabled`) or removes it. A personal hook (inside `.git` or outside
   * the working copy) also names this machine's node and estimetry, for a commit without PATH;
   * a hook the project commits never does.
   */
  plan(projectRoot: string, enabled: boolean): InstallPlan;
}
