import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cliSandbox, ROOT, spawnNode } from '../support/cli.js';
import { tempDir } from '../support/temp-dir.js';

describe('concurrent writers', () => {
  it('20 processes × 50 appends leave 1000 whole lines in one journal', async () => {
    const file = join(tempDir(), 'events', 'T-1.jsonl');
    const jsonl = pathToFileURL(join(ROOT, 'dist', 'infrastructure', 'fs', 'jsonl.js')).href;
    const script = `
      const { appendJsonLine } = await import(${JSON.stringify(jsonl)});
      const writer = Number(process.argv[1]);
      for (let i = 0; i < 50; i++) appendJsonLine(${JSON.stringify(file)}, { writer, i, pad: 'x'.repeat(2000) });
    `;
    const codes = await Promise.all(
      Array.from({ length: 20 }, (_, writer) => spawnNode(['--input-type=module', '-e', script, String(writer)])),
    );
    expect(codes.every((code) => code === 0)).toBe(true);

    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(1000);
    const records = lines.map((line) => JSON.parse(line) as { writer: number; i: number });
    expect(new Set(records.map((r) => `${r.writer}:${r.i}`)).size).toBe(1000);
  });

  it('10 concurrent `task new` get 10 different ids and lose nothing', async () => {
    const cli = cliSandbox();
    const repo = cli.repo('api');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: repo });

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => cli.run(['task', 'new', `Task ${i}`, '--json'], repo)));
    expect(results.map((r) => r.code)).toEqual(Array(10).fill(0));
    const ids = results.map((r) => (JSON.parse(r.stdout) as { id: string }).id);
    expect(new Set(ids).size).toBe(10);

    const listed = JSON.parse((await cli.run(['task', 'list', '--json'], repo)).stdout) as { id: string; title: string }[];
    expect(listed.map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(new Set(listed.map((t) => t.title)).size).toBe(10);
    expect(readFileSync(join(cli.home, 'projects.yaml'), 'utf8').match(/id: api/g)).toHaveLength(1);
  });
});
