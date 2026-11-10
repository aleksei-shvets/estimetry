import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SessionId } from '../../src/domain/measurement/session-id.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { YamlLogImportState } from '../../src/infrastructure/persistence/yaml-log-import-state.js';
import { YamlSessionStore } from '../../src/infrastructure/persistence/yaml-session-store.js';
import { ROOT, spawnNode } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

const entry = (next: number) => ({ next, fingerprint: { main: { size: next, mtimeMs: 1 }, agents: { a1: { size: 3, mtimeMs: 2 } } } });

describe('the cache of log imports', () => {
  it('keeps an entry per task of a session; a broken file reads as empty', () => {
    const layout = new StorageLayout(join(tempDir(), 'home'));
    const state = new YamlLogImportState(layout);
    expect(state.read('s1')).toEqual({});
    state.locked('s1', () => {
      state.write('s1', 'T-1', entry(10));
      state.write('s1', 'T-2', entry(20));
    });
    expect(state.read('s1')).toEqual({ 'T-1': entry(10), 'T-2': entry(20) });
    writeFileSync(layout.logImport('s1'), 'tasks: [oops');
    expect(state.read('s1')).toEqual({});
  });

  it('two processes importing one session never interleave', async () => {
    const home = join(tempDir(), 'home');
    const out = join(tempDir(), 'order.txt');
    writeFileSync(out, '');
    const dist = (p: string) => JSON.stringify(pathToFileURL(join(ROOT, 'dist', p)).href);
    const script = `
      const { appendFileSync } = await import('node:fs');
      const { YamlLogImportState } = await import(${dist('infrastructure/persistence/yaml-log-import-state.js')});
      const { StorageLayout } = await import(${dist('infrastructure/fs/storage-layout.js')});
      const state = new YamlLogImportState(new StorageLayout(${JSON.stringify(home)}));
      const n = process.argv[1];
      state.locked('s1', () => {
        appendFileSync(${JSON.stringify(out)}, 'start ' + n + '\\n');
        const until = Date.now() + 150;
        while (Date.now() < until) {}
        appendFileSync(${JSON.stringify(out)}, 'end ' + n + '\\n');
      });
    `;
    const codes = await Promise.all([0, 1, 2].map((n) => spawnNode(['--input-type=module', '-e', script, String(n)])));
    expect(codes).toEqual([0, 0, 0]);
    const lines = readFileSync(out, 'utf8').trim().split('\n');
    for (let i = 0; i < lines.length; i += 2) {
      expect(lines[i]?.replace('start', 'end')).toBe(lines[i + 1]);
    }
  });
});

describe('a session binding', () => {
  it('keeps every task it served and the path of its log across switches', () => {
    const store = new YamlSessionStore(new StorageLayout(join(tempDir(), 'home')));
    const s1 = SessionId.parse('s1');
    store.update(s1, () => ({ session: 's1', project: 'api', root: '/r', task: 'T-1', transcript: '/logs/s1.jsonl' }));
    store.update(s1, () => ({ session: 's1', project: 'api', root: '/r', task: 'T-2' }));
    store.update(s1, () => ({ session: 's1', project: 'api', root: '/r', closedTask: 'T-2' }));
    expect(store.get(s1)).toMatchObject({ tasks: ['T-1', 'T-2'], transcript: '/logs/s1.jsonl', closedTask: 'T-2' });
  });
});
