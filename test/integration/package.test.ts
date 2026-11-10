import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

/** A copy of the repository with only what a fresh clone has and no `dist`: the packing builds it. */
function cleanCopy(): string {
  const copy = tempDir('pack-src-');
  for (const entry of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'src']) {
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
    const init = run('estimetry', ['init', '--no-interactive', '--json'], repo);
    expect(init.status, init.stderr).toBe(0);
    expect((JSON.parse(init.stdout) as { tools: string[] }).tools).toContain('claude-code');
  }, 180_000);
});
