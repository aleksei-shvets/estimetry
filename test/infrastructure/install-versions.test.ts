import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { YamlInstallVersions } from '../../src/infrastructure/persistence/yaml-install-versions.js';
import { ROOT, spawnNode } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

describe('YamlInstallVersions', () => {
  it('records the version of each copy and reads it back; a missing or broken file records nothing', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const versions = new YamlInstallVersions(layout);
    expect(versions.read('/work/api')).toBeUndefined();
    versions.record('/work/api', '0.1.0');
    versions.record('/work/web', '0.1.0');
    versions.record('/work/api', '0.2.0');
    expect(new YamlInstallVersions(layout).read('/work/api')).toBe('0.2.0');
    expect(new YamlInstallVersions(layout).read('/work/web')).toBe('0.1.0');
    writeFileSync(layout.installsFile, 'installs: [broken');
    expect(versions.read('/work/api')).toBeUndefined();
  });

  it('loses no record when copies are set up in parallel processes', async () => {
    const home = join(tempDir(), 'home');
    const dist = (p: string) => JSON.stringify(pathToFileURL(join(ROOT, 'dist', p)).href);
    const script = `
      const { YamlInstallVersions } = await import(${dist('infrastructure/persistence/yaml-install-versions.js')});
      const { StorageLayout } = await import(${dist('infrastructure/fs/storage-layout.js')});
      new YamlInstallVersions(new StorageLayout(${JSON.stringify(home)})).record('/work/copy-' + process.argv[1], '0.2.0');
    `;
    const codes = await Promise.all(Array.from({ length: 8 }, (_, n) => spawnNode(['--input-type=module', '-e', script, String(n)])));
    expect(codes).toEqual(Array(8).fill(0));
    const versions = new YamlInstallVersions(new StorageLayout(home));
    expect(Array.from({ length: 8 }, (_, n) => versions.read(`/work/copy-${n}`))).toEqual(Array(8).fill('0.2.0'));
  });
});
