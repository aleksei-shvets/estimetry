import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

const SCRIPT = join(ROOT, 'scripts', 'release-notes.mjs');

const CHANGELOG = `# Changelog

## 0.2.0 — 2026-12-01

- Second.

### Fixed

- A bug.

## 0.1.0 — 2026-11-11

- First.
`;

function release(tag: string, version = '0.2.0', changelog = CHANGELOG) {
  const dir = tempDir('release-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  return spawnSync(process.execPath, [SCRIPT, tag], { cwd: dir, encoding: 'utf8' });
}

describe('release notes of a tag', () => {
  it('prints the section of the version, up to the next version', () => {
    const result = release('v0.2.0');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('- Second.\n\n### Fixed\n\n- A bug.\n');
    expect(release('v0.1.0', '0.1.0').stdout).toBe('- First.\n');
  });

  it('refuses a tag out of the vX.Y.Z format', () => {
    for (const tag of ['v0.2.0-rc.1', 'v01.2.0', 'v0.02.0', '0.2.0', 'release-1', 'v0.2']) {
      const result = release(tag);
      expect(result.status, tag).toBe(1);
      expect(result.stderr).toContain('vX.Y.Z');
    }
  });

  it('refuses a tag that differs from the version in package.json', () => {
    const result = release('v0.2.1');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('0.2.0');
  });

  it('refuses a version without its section in the changelog', () => {
    const result = release('v0.3.0', '0.3.0');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('## 0.3.0');
  });

  it('refuses an empty section', () => {
    const result = release('v0.3.0', '0.3.0', '# Changelog\n\n## 0.3.0\n\n## 0.2.0\n\n- x\n');
    expect(result.status).toBe(1);
  });
});
