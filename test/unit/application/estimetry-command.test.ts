import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimetryCommand, isEstimetryCommand } from '../../../src/application/contracts/estimetry-command.js';
import { tempDir } from '../../support/temp-dir.js';

/** A stand-in for an estimetry: prints who it is, its arguments and the data directory it got. */
function standIn(dir: string, name: string): string {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "${name.split('/').at(-1)} $* $ESTIMETRY_HOME"\n`);
  chmodSync(path, 0o755);
  return path;
}

const sh = (command: string, env: NodeJS.ProcessEnv) => spawnSync('/bin/sh', ['-c', command], { env, encoding: 'utf8' }).stdout.trim();

/** An estimetry on PATH and a "node" of this installation; the stand-in node only says it ran, with its arguments. */
function installs(): { bin: string; node: string; main: string } {
  const dir = tempDir('runner-');
  standIn(dir, 'bin/estimetry');
  const node = standIn(dir, "node dir/it's node");
  const main = join(dir, 'main.js');
  writeFileSync(main, '');
  return { bin: join(dir, 'bin'), node, main };
}

describe('the command a hook runs estimetry with', () => {
  it('runs this installation by its paths, with its data directory, even with estimetry on PATH', () => {
    const { bin, node, main } = installs();
    expect(sh(estimetryCommand({ node, main, home: '/data/e' }, 'hook claude-code Stop'), { PATH: `${bin}:/usr/bin:/bin` })).toBe(
      `it's node ${main} hook claude-code Stop /data/e`,
    );
  });

  it('keeps the data directory the user set', () => {
    const { node, main } = installs();
    expect(sh(estimetryCommand({ node, main, home: '/data/e' }, 'x'), { PATH: '/usr/bin:/bin', ESTIMETRY_HOME: '/mine' })).toBe(
      `it's node ${main} x /mine`,
    );
  });

  it('falls back to estimetry on PATH when the paths are gone, and is that alone without them', () => {
    const { bin, main } = installs();
    expect(sh(estimetryCommand({ node: '/gone/node', main, home: '/data/e' }, 'x'), { PATH: `${bin}:/usr/bin:/bin` })).toBe('estimetry x');
    expect(estimetryCommand(undefined, 'hook git post-commit')).toBe('estimetry hook git post-commit');
  });

  it('is recognised by the rule that writes it, in both forms and from older versions; a command of the user is not', () => {
    const runner = { node: "/opt/it's node", main: '/opt/main.js', home: '/data' };
    expect(isEstimetryCommand(estimetryCommand(runner, 'hook claude-code Stop'), 'hook claude-code')).toBe(true);
    expect(isEstimetryCommand(estimetryCommand(undefined, 'hook claude-code Stop'), 'hook claude-code')).toBe(true);
    expect(isEstimetryCommand('estimetry hook claude-code', 'hook claude-code')).toBe(true);
    expect(isEstimetryCommand(estimetryCommand(runner, 'hook git post-commit'), 'hook claude-code')).toBe(false);
    expect(isEstimetryCommand('notify; estimetry hook claude-code Stop', 'hook claude-code')).toBe(false);
    expect(isEstimetryCommand("estimetry_home='/x'; my-script; else estimetry hook claude-code Stop", 'hook claude-code')).toBe(false);
  });
});
