import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function violations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('layer boundaries', () => {
  it.each([
    ['src/domain/task/task.ts', "import { x } from '../../infrastructure/fs/jsonl.js';"],
    ['src/domain/task/task.ts', "import { x } from '../../application/ports/clock.js';"],
    ['src/domain/task/task.ts', "import { readFileSync } from 'node:fs';"],
    ['src/domain/task/task.ts', "import { parse } from 'yaml';"],
    ['src/application/task/create-task.ts', "import { x } from '../../infrastructure/fs/jsonl.js';"],
    ['src/application/task/create-task.ts', "import { readFileSync } from 'node:fs';"],
    ['src/infrastructure/fs/jsonl.ts', "import { x } from '../../interface/cli/program.js';"],
    ['src/integrations/tools/registry.ts', "import { x } from '../../infrastructure/fs/jsonl.js';"],
    ['src/interface/cli/program.ts', "import { x } from '../../infrastructure/fs/jsonl.js';"],
    ['src/interface/cli/program.ts', "import { x } from '../../bootstrap/container.js';"],
  ])('%s rejects: %s', async (filePath, code) => {
    expect(await violations(filePath, `${code}\nexport { x };`)).toContain('no-restricted-imports');
  });

  it.each([
    ['src/domain/task/task.ts', "import { x } from '../shared/domain-error.js';"],
    ['src/application/task/create-task.ts', "import { x } from '../../domain/task/task.js';"],
    ['src/infrastructure/fs/jsonl.ts', "import { x } from '../../application/ports/clock.js';"],
    ['src/interface/cli/program.ts', "import { x } from '../../application/estimetry.js';"],
    ['src/bootstrap/container.ts', "import { x } from '../infrastructure/fs/jsonl.js';"],
  ])('%s allows: %s', async (filePath, code) => {
    expect(await violations(filePath, `${code}\nexport { x };`)).not.toContain('no-restricted-imports');
  });

  it('domain must not read the clock or randomness directly', async () => {
    const found = await violations(
      'src/domain/task/task.ts',
      'export const a = Date.now(); export const b = Math.random(); export const c = new Date();',
    );
    expect(found).toEqual(['no-restricted-properties', 'no-restricted-properties', 'no-restricted-syntax']);
  });

  it('domain and application must not touch process state', async () => {
    expect(await violations('src/application/x.ts', 'export const h = process.env.HOME;')).toContain(
      'no-restricted-globals',
    );
  });
});
