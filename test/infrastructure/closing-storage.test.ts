import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calibrate } from '../../src/domain/calibration/calibration.js';
import type { Card } from '../../src/domain/card/card.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { GitCodeMeasurer } from '../../src/infrastructure/git/git-code-measurer.js';
import { FileCloseProposals } from '../../src/infrastructure/persistence/file-close-proposals.js';
import { JsonCalibrationStore } from '../../src/infrastructure/persistence/json-calibration-store.js';
import { YamlCardStore } from '../../src/infrastructure/persistence/yaml-card-store.js';
import { ROOT, spawnNode } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo(email = 'dev@example.com'): string {
  const dir = tempDir('repo-');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', email);
  git(dir, 'config', 'user.name', 'Dev');
  writeFileSync(join(dir, 'a.ts'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

function commitFile(dir: string, path: string, lines: number, message = 'work', author?: string): string {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n') + '\n');
  git(dir, 'add', '.');
  git(dir, ...(author === undefined ? [] : ['-c', `user.email=${author}`]), 'commit', '-qm', message);
  return git(dir, 'rev-parse', 'HEAD');
}

describe('GitCodeMeasurer', () => {
  const measurer = new GitCodeMeasurer();

  it('counts the author’s commits since the base, without a colleague’s ones', () => {
    const dir = repo();
    const base = git(dir, 'rev-parse', 'HEAD');
    const mine = commitFile(dir, 'src/b.ts', 10);
    commitFile(dir, 'src/c.ts', 7, 'colleague', 'other@example.com');
    const commits = measurer.authorCommits(dir, base);
    expect(commits?.map((c) => c.sha)).toEqual([mine]);
    expect(commits?.[0]?.files).toEqual([{ path: 'src/b.ts', added: 10, deleted: 0 }]);
  });

  it('tells reachable from unreachable commits after amend and squash', () => {
    const dir = repo();
    const first = commitFile(dir, 'src/b.ts', 3);
    writeFileSync(join(dir, 'src/b.ts'), 'x\ny\nz\nw\n');
    git(dir, 'commit', '-qa', '--amend', '--no-edit');
    expect(measurer.reachable(dir, first)).toBe(false);
    expect(measurer.reachable(dir, git(dir, 'rev-parse', 'HEAD'))).toBe(true);

    const one = commitFile(dir, 'src/c.ts', 1, 'one');
    const two = commitFile(dir, 'src/d.ts', 1, 'two');
    execFileSync('git', ['rebase', '-qi', 'HEAD~2'], {
      cwd: dir,
      env: { ...process.env, GIT_SEQUENCE_EDITOR: "sed -i.bak '2s/^pick/squash/'", GIT_EDITOR: 'true' },
      stdio: 'ignore',
    });
    expect([measurer.reachable(dir, one), measurer.reachable(dir, two)]).toEqual([false, false]);
    expect(measurer.reachable(dir, 'deadbeef')).toBeUndefined();
  });

  it('a base on another branch is not an ancestor', () => {
    const dir = repo();
    git(dir, 'checkout', '-qb', 'feature');
    const onFeature = commitFile(dir, 'src/f.ts', 2);
    git(dir, 'checkout', '-q', '-');
    expect(measurer.reachable(dir, onFeature)).toBe(false);
  });

  it('adds uncommitted changes and new untracked files by their lines, binary ones as binary', () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.ts'), 'a\nb\n');
    writeFileSync(join(dir, 'new.ts'), 'one\ntwo\nthree\n');
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    git(dir, 'mv', 'a.ts', 'renamed.ts');
    const files = measurer.uncommitted(dir);
    expect(files).toEqual(
      expect.arrayContaining([
        { path: 'new.ts', added: 3, deleted: 0 },
        { path: 'logo.png', added: null, deleted: null },
      ]),
    );
    expect(files?.some((f) => f.path.includes('renamed.ts'))).toBe(true);
    expect(measurer.uncommitted(tempDir('not-git-'))).toBeUndefined();
  });
});

describe('close proposals', () => {
  it('hands a proposal out exactly once to parallel processes', async () => {
    const home = join(tempDir(), 'home');
    const layout = new StorageLayout(home);
    new FileCloseProposals(layout).put('T-1', { change: 'a', completedAt: '2026-10-27T10:00:00.000Z', session: 's1' });
    const dist = (p: string) => JSON.stringify(pathToFileURL(join(ROOT, 'dist', p)).href);
    const out = join(home, 'out');
    mkdirSync(out, { recursive: true });
    const script = `
      const { FileCloseProposals } = await import(${dist('infrastructure/persistence/file-close-proposals.js')});
      const { StorageLayout } = await import(${dist('infrastructure/fs/storage-layout.js')});
      const { writeFileSync } = await import('node:fs');
      const taken = new FileCloseProposals(new StorageLayout(${JSON.stringify(home)})).take('T-1');
      if (taken) writeFileSync(${JSON.stringify(out)} + '/' + process.argv[1], taken.change);
    `;
    const codes = await Promise.all(Array.from({ length: 8 }, (_, n) => spawnNode(['--input-type=module', '-e', script, String(n)])));
    expect(codes).toEqual(Array(8).fill(0));
    expect(execFileSync('ls', [out], { encoding: 'utf8' }).trim().split('\n').filter((l) => l !== '')).toHaveLength(1);
    expect(existsSync(layout.closeProposal('T-1'))).toBe(false);
  });
});

describe('cards and calibration', () => {
  const card = (id: string): Card =>
    ({
      schemaVersion: 3,
      author: 'dev@example.com',
      task: { id, type: 'feature', stack: ['go'] },
      outcome: 'completed',
      fact: { totalMinutes: 60, uncertaintyShare: 0, counted: { totalMinutes: 60, uncertaintyShare: 0, sequentialMinutes: null, minimal: false } },
      estimate: { likelyHours: 1, baseLikelyHours: 1, type: 'feature' },
      currentEstimate: { likelyHours: 1, baseLikelyHours: 1, type: 'feature' },
      revisions: [],
      accuracy: 'partial',
      usage: null,
      parallel: { used: false, sequentialMinutes: null },
      parts: [],
      currentParts: [],
      beforeRevisionMinutes: 0,
      coveredByRevision: {},
      extras: {
        'new-requirement': { absorbed: { count: 0, timed: 0, minutes: 0 }, renegotiated: { count: 0, timed: 0, minutes: 0 } },
        'missed-analysis': { absorbed: { count: 0, timed: 0, minutes: 0 }, renegotiated: { count: 0, timed: 0, minutes: 0 } },
        rework: { absorbed: { count: 0, timed: 0, minutes: 0 }, renegotiated: { count: 0, timed: 0, minutes: 0 } },
        environment: { absorbed: { count: 0, timed: 0, minutes: 0 }, renegotiated: { count: 0, timed: 0, minutes: 0 } },
      },
      code: null,
      partsFact: 'no-plan-snapshots',
    }) as unknown as Card;

  it('keeps cards by task, reads a broken card as missing, and writes calibration from all of them', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const cards = new YamlCardStore(layout);
    cards.write(card('T-1'));
    cards.write(card('T-2'));
    writeFileSync(layout.card('T-3'), 'schemaVersion: [oops');
    expect(cards.list().map((c) => (c.schema === 'current' ? c.card.task.id : undefined))).toEqual(['T-1', 'T-2']);
    cards.remove('T-2');
    const store = new JsonCalibrationStore(layout, () => '2026-11-02T00:00:00.000Z');
    store.recalculate(() => calibrate(cards.list().flatMap((c) => (c.schema === 'current' ? [c.card] : []))));
    const written = JSON.parse(readFileSync(layout.calibrationFile, 'utf8')) as { generatedAt: string; authors: Record<string, { tasks: number }> };
    expect(written.generatedAt).toBe('2026-11-02T00:00:00.000Z');
    expect(written.authors['dev@example.com']?.tasks).toBe(1);
    expect(existsSync(layout.calibrationLock)).toBe(false);
  });

  it('tells cards of schemas 1 and 2 and a card of a newer schema from a current one', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const cards = new YamlCardStore(layout);
    const { currentEstimate: _e, revisions: _r, currentParts: _p, beforeRevisionMinutes: _b, coveredByRevision: _c, ...old } = card('T-1') as unknown as Record<string, unknown>;
    cards.write({ ...old, schemaVersion: 1 } as unknown as Card);
    cards.write({ ...card('T-2'), schemaVersion: 4 });
    cards.write(card('T-3'));
    const { usage: _u, ...v2 } = card('T-5') as unknown as Record<string, unknown>;
    cards.write({ ...v2, schemaVersion: 2 } as unknown as Card);
    expect(cards.list().map((c) => c.schema)).toEqual(['v1', 'newer', 'current', 'v2']);
    expect(cards.read('T-2')).toEqual({ schema: 'newer', task: 'T-2', version: 4 });
    const { parallel: _parallel, ...broken } = old;
    cards.write({ ...broken, schemaVersion: 1, task: { id: 'T-4', type: 'feature', stack: [] } } as unknown as Card);
    expect(cards.read('T-4')).toBeUndefined();
  });

  it('parallel closings leave a calibration built from every card', async () => {
    const home = join(tempDir(), 'home');
    const dist = (p: string) => JSON.stringify(pathToFileURL(join(ROOT, 'dist', p)).href);
    const template = JSON.stringify(card('T-0'));
    const script = `
      const { YamlCardStore } = await import(${dist('infrastructure/persistence/yaml-card-store.js')});
      const { JsonCalibrationStore } = await import(${dist('infrastructure/persistence/json-calibration-store.js')});
      const { StorageLayout } = await import(${dist('infrastructure/fs/storage-layout.js')});
      const { calibrate } = await import(${dist('domain/calibration/calibration.js')});
      const layout = new StorageLayout(${JSON.stringify(home)});
      const cards = new YamlCardStore(layout);
      const card = JSON.parse(${JSON.stringify(template)});
      card.task.id = 'T-' + (Number(process.argv[1]) + 1);
      cards.write(card);
      new JsonCalibrationStore(layout, () => new Date().toISOString()).recalculate(() => calibrate(cards.list().flatMap((c) => (c.schema === 'current' ? [c.card] : []))));
    `;
    const codes = await Promise.all(Array.from({ length: 6 }, (_, n) => spawnNode(['--input-type=module', '-e', script, String(n)])));
    expect(codes).toEqual(Array(6).fill(0));
    const written = JSON.parse(readFileSync(new StorageLayout(home).calibrationFile, 'utf8')) as { authors: Record<string, { tasks: number }> };
    expect(written.authors['dev@example.com']?.tasks).toBe(6);
  });
});
