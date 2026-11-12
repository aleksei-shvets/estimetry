import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

/**
 * A copy of the repository with what a fresh clone has and no `dist`: the packing builds it.
 * Every tracked entry of the root is copied, so a file npm always packs (any `README*`) is seen.
 */
function cleanCopy(): string {
  const copy = tempDir('pack-src-');
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((path) => path !== '');
  // A tracked file deleted in the working tree is not in a fresh clone of it either.
  for (const entry of new Set(tracked.map((path) => path.split('/')[0] ?? path).filter((entry) => existsSync(join(ROOT, entry))))) {
    cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
  }
  symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'), 'dir');
  return copy;
}

describe('the npm package', () => {
  it('builds on packing, holds only the built code and the docs, and works once installed', () => {
    const source = cleanCopy();
    expect(existsSync(join(source, 'dist'))).toBe(false);
    const out = tempDir('pack-out-');
    const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', out], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as {
      filename: string;
      files: { path: string }[];
    }[];
    const files = packed[0]?.files.map((file) => file.path) ?? [];
    expect(files).toEqual(expect.arrayContaining(['dist/bootstrap/main.js', 'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json']));
    expect(files.filter((path) => !path.startsWith('dist/') && !['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json'].includes(path))).toEqual([]);
    expect(files.filter((path) => path.endsWith('.map') || path.endsWith('.ts'))).toEqual([]);
    // npm shows the README it finds first: only the English one may be in the package.
    expect(files.filter((path) => /^readme/i.test(path))).toEqual(['README.md']);

    const prefix = tempDir('pack-prefix-');
    execFileSync(npm, ['install', '-g', '--prefer-offline', '--no-audit', '--no-fund', '--prefix', prefix, join(out, packed[0]?.filename ?? '')], {
      stdio: 'ignore',
    });
    const user = tempDir('pack-user-');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: user,
      ESTIMETRY_HOME: join(user, 'estimetry'),
      CLAUDE_CONFIG_DIR: join(user, '.claude'),
      XDG_CONFIG_HOME: join(user, '.config'),
      GIT_CONFIG_GLOBAL: join(user, '.gitconfig'),
    };
    delete env['CI'];
    const bin = (name: string) => join(prefix, 'bin', name);
    const run = (name: string, args: readonly string[], cwd = user) => spawnSync(bin(name), args, { cwd, env, encoding: 'utf8' });

    for (const name of ['emt', 'estimetry']) {
      expect(run(name, ['--version'])).toMatchObject({ status: 0, stdout: `${version}\n` });
    }
    expect(run('emt', ['--help']).stdout).toContain('Usage: emt');

    const repo = join(user, 'app');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo, env });
    const init = run('estimetry', ['init', '--no-interactive', '--json', '--track-commits'], repo);
    expect(init.status, init.stderr).toBe(0);
    expect((JSON.parse(init.stdout) as { tools: string[] }).tools).toContain('claude-code');
    // The personal commit hook names the node and the entry point of this install, for a commit without PATH.
    const hook = readFileSync(join(repo, '.git', 'hooks', 'post-commit'), 'utf8');
    const [, node = '', main = ''] = /if \[ -x '([^']+)' \] && \[ -f '([^']+)' \]/.exec(hook) ?? [];
    expect(existsSync(node) && existsSync(main)).toBe(true);
    expect(main.startsWith(prefix)).toBe(true);
    // The Claude Code hooks run the same installation.
    expect(readFileSync(join(repo, '.claude', 'settings.local.json'), 'utf8')).toContain(`'${main}' hook claude-code SessionStart`);
  }, 180_000);
});
