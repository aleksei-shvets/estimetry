import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { Card } from '../../src/domain/card/card.js';
import { cliSandbox, type CliSandbox } from '../support/cli.js';
import { syntheticCard } from '../support/cards.js';

let cli: CliSandbox;
let cwd: string;

const emt = (...args: string[]) => cli.run(args, cwd);

function cards(...list: Card[]): void {
  mkdirSync(join(cli.home, 'cards'), { recursive: true });
  for (const card of list) {
    writeFileSync(join(cli.home, 'cards', `${card.task.id}.yaml`), stringify(card));
  }
}

beforeEach(() => {
  cli = cliSandbox();
  cwd = cli.repo('elsewhere');
  mkdirSync(cli.home, { recursive: true });
  writeFileSync(join(cli.home, 'config.yaml'), stringify({ schemaVersion: 1, author: { id: 'dev@example.com', aliases: ['old@example.com'] } }));
});

const six = () =>
  Array.from({ length: 6 }, (_, i) =>
    syntheticCard({ id: `T-${i + 1}`, stack: ['typescript', 'node'], ratio: 1 + i / 10, closedAt: `2026-10-0${i + 1}T18:00:00.000Z` }),
  );

describe('emt similar', () => {
  it('orders by similarity and prints a stable JSON', async () => {
    cards(...six(), syntheticCard({ id: 'T-7', type: 'research', stack: ['go'] }), syntheticCard({ id: 'T-8', author: 'old@example.com', stack: ['go'] }));
    const text = await emt('similar', '--type', 'feature', '--stack', 'TypeScript,node', '--hours', '10', '--limit', '3');
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^Similar closed tasks \(type feature, stack typescript, node, about 10h\):/);
    expect(text.stdout.indexOf('T-6')).toBeLessThan(text.stdout.indexOf('T-5'));
    const json = await emt('similar', '--type', 'feature', '--stack', 'typescript,node', '--hours', '10', '--limit', '3', '--json');
    expect(JSON.parse(json.stdout)).toMatchSnapshot();
  });

  it('a card of a newer estimetry is skipped; nothing to compare by is an error', async () => {
    cards(...six());
    writeFileSync(join(cli.home, 'cards', 'T-9.yaml'), stringify({ schemaVersion: 4, task: { id: 'T-9' } }));
    const json = JSON.parse((await emt('similar', '--type', 'feature', '--json')).stdout) as { skipped: string[] };
    expect(json.skipped).toEqual(['T-9']);
    const none = await emt('similar');
    expect(none.code).toBe(1);
    expect(none.stderr).toMatch(/--type <type> or --stack <labels>/);
    expect((await emt('similar', '--type', 'feture')).code).toBe(1);
  });
});

describe('emt calibrate', () => {
  it('names the coefficient of the type and prints a stable JSON, writing nothing', async () => {
    cards(...six());
    const text = await emt('calibrate', '--type', 'feature', '--stack', 'typescript');
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^Coefficient ×1\.25 \(type feature, 6 tasks, first estimates\)/);
    const json = await emt('calibrate', '--type', 'feature', '--stack', 'typescript', '--json');
    expect(JSON.parse(json.stdout)).toMatchSnapshot();
    expect(existsSync(join(cli.home, 'calibration.json'))).toBe(false);
  });

  it('says without calibration on a small sample and with --revise when nothing was revised', async () => {
    cards(...six().slice(0, 2));
    expect((await emt('calibrate', '--type', 'feature')).stdout).toMatch(/^Without calibration: type feature 2 of 5 tasks needed\. Overall ×1\.05 \(2 tasks\) is for reference only\./);
    cards(...six());
    const revise = JSON.parse((await emt('calibrate', '--type', 'feature', '--revise', '--json')).stdout) as { coefficient: unknown };
    expect(revise.coefficient).toBeNull();
  });

  it('next to a card of a newer estimetry gives no coefficient and leaves calibration.json as it was', async () => {
    cards(...six());
    writeFileSync(join(cli.home, 'calibration.json'), '{"kept":true}\n');
    writeFileSync(join(cli.home, 'cards', 'T-9.yaml'), stringify({ schemaVersion: 4, task: { id: 'T-9' } }));
    const result = await emt('calibrate', '--type', 'feature');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Without calibration/);
    expect(result.stdout).toMatch(/^Without calibration: cards of a newer estimetry \(T-9\) cannot be read, so no coefficient is given — update estimetry\./);
    expect(result.stdout).not.toMatch(/tasks needed/);
    expect(readFileSync(join(cli.home, 'calibration.json'), 'utf8')).toBe('{"kept":true}\n');
  });
});

describe('emt task show', () => {
  it('gives the estimate in force part by part, in the format of an estimate file', async () => {
    expect((await emt('task', 'new', 'Import', '--type', 'feature')).code).toBe(0);
    writeFileSync(join(cwd, 'plan.yaml'), 'schemaVersion: 1\ntype: feature\nstack: [TypeScript]\nparts:\n  - { name: implementation, hours: { optimistic: 1, likely: 2, pessimistic: 3 } }\n  - { name: manual testing, kind: manual-testing, hours: { optimistic: 0.5, likely: 1, pessimistic: 2 } }\n');
    expect((await emt('estimate', 'save', 'plan.yaml')).code).toBe(0);
    const json = JSON.parse((await emt('task', 'show', 'T-1', '--json')).stdout) as { estimate: { schemaVersion: number; stack: string[]; parts: { id: string }[] } };
    expect(json.estimate).toMatchObject({ schemaVersion: 1, stack: ['typescript'], parts: [{ id: 'implementation' }, { id: 'manual-testing' }] });
    expect((await emt('task', 'show', 'T-1')).stdout).toMatch(/estimate\s+1\.5 \/ 3 \/ 5 h \(feature; typescript; without calibration\)\n\s+implementation\s+1 \/ 2 \/ 3 h, implementation/);
  });
});

