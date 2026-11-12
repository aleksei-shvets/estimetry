import type { InstallVersions } from '../../application/ports/install-versions.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';

const SCHEMA_VERSION = 1;

/** `installs.yaml`: the root of each working copy → the version of estimetry that set it up; written under `installs.lock`. */
export class YamlInstallVersions implements InstallVersions {
  constructor(private readonly layout: StorageLayout) {}

  read(root: string): string | undefined {
    return this.all()[root];
  }

  record(root: string, version: string): void {
    withFileLock(this.layout.installsLock, () => {
      const installs = this.all();
      if (installs[root] !== version) {
        writeYamlAtomic(this.layout.installsFile, { schemaVersion: SCHEMA_VERSION, installs: { ...installs, [root]: version } });
      }
    });
  }

  /** A missing or broken file records nothing: every copy then counts as set up before versions were recorded. */
  private all(): Record<string, string> {
    let data: unknown;
    try {
      data = readYaml(this.layout.installsFile);
    } catch {
      return {};
    }
    if (typeof data !== 'object' || data === null || !('installs' in data)) {
      return {};
    }
    const installs = data.installs;
    if (typeof installs !== 'object' || installs === null) {
      return {};
    }
    return Object.fromEntries(Object.entries(installs).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }
}
