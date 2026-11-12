import type { InstallVersions } from '../ports/install-versions.js';
import { installOutdated } from '../shared/install-outdated.js';
import { upgradeText } from './hook-context.js';

/**
 * The line of the session start about an outdated install (claude-code-hooks
 * spec): only the session start reads the version of the install, one small file.
 */
export class UpgradeNotice {
  constructor(
    private readonly versions: Pick<InstallVersions, 'read'>,
    private readonly current: () => string,
  ) {}

  /** `root` is the working copy of the session; undefined when its install is current. */
  text(root: string): string | undefined {
    const installed = this.versions.read(root);
    const current = this.current();
    return installOutdated(installed, current) ? upgradeText(current, installed) : undefined;
  }
}
