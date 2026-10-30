import type { InstallPlan } from '../contracts/file-change.js';

/** The git `post-commit` hook that reports commits to estimetry. */
export interface CommitHookInstaller {
  installed(projectRoot: string): boolean;
  /** Adds the estimetry block (`enabled`) or removes it. */
  plan(projectRoot: string, enabled: boolean): InstallPlan;
}
