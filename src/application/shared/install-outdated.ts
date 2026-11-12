const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * Whether a copy set up by `installed` is older than the running `current`:
 * a copy without a recorded version predates the record, so it is. A newer or
 * unreadable version is not: upgrading would go backwards or guess.
 */
export function installOutdated(installed: string | undefined, current: string): boolean {
  if (installed === undefined) {
    return true;
  }
  const from = SEMVER.exec(installed);
  const to = SEMVER.exec(current);
  if (from === null || to === null) {
    return false;
  }
  for (let i = 1; i <= 3; i++) {
    const delta = Number(to[i]) - Number(from[i]);
    if (delta !== 0) {
      return delta > 0;
    }
  }
  return false;
}
