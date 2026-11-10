import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { TASK_STATUSES } from '../../src/domain/task/task-status.js';
import { ROOT } from '../support/cli.js';

/** The list of current violations, as `eslint/guardrails.js` keeps it. */
interface Debt {
  statusLiteral: Record<string, number>;
  taskImportsHooks: Record<string, number>;
  nodePath: Record<string, number>;
  maxLines: Record<string, number>;
  maxFunctionLines: Record<string, number>;
}

interface Guardrails {
  DEBT: Debt;
  TASK_STATUS_VALUES: readonly string[];
}

let guardrails: Guardrails;
let config: (debt: Debt) => Linter.Config[];

beforeAll(async () => {
  // Plain JavaScript modules outside the TypeScript project: loaded by URL, typed here.
  guardrails = (await import(pathToFileURL(join(ROOT, 'eslint', 'guardrails.js')).href)) as Guardrails;
  config = ((await import(pathToFileURL(join(ROOT, 'eslint.config.js')).href)) as { config: typeof config }).config;
});

const eslint = (debt: Debt) => new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: config(debt) });

async function messages(code: string, filePath: string, debt = guardrails.DEBT) {
  const [result] = await eslint(debt).lintText(code, { filePath: join(ROOT, filePath) });
  return result?.messages ?? [];
}

const lines = (count: number) => Array.from({ length: count }, (_, i) => `export const v${i} = ${i};`).join('\n');
/** A function of `body + 3` lines: its head, `body` statements, `return` and the closing brace. */
const longFunction = (body: number) => `export function f(): number {\n${Array.from({ length: body }, (_, i) => `  const a${i} = ${i};`).join('\n')}\n  return 0;\n}\n`;

describe('architecture checks', () => {
  it('a task status compared with a string in application is an error, another status is not', async () => {
    const closed = await messages("declare const task: { status: string };\nexport const c = task.status === 'closed';\n", 'src/application/task/x.ts');
    expect(closed.map((m) => m.message).join('\n')).toMatch(/method of the aggregate|task-status/);
    const chained = await messages("declare const summary: { status: string } | undefined;\nexport const c = summary?.status !== 'in-progress';\n", 'src/application/hooks/x.ts');
    expect(chained.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
    const reversed = await messages("declare const status: string;\nexport const c = 'new' == status;\n", 'src/application/task/x.ts');
    expect(reversed.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
    const other = await messages("declare const read: { status: string };\nexport const c = read.status === 'no-data';\n", 'src/application/task/x.ts');
    expect(other).toEqual([]);
  });

  it('the statuses of the rule are the statuses of a task', () => {
    expect([...guardrails.TASK_STATUS_VALUES].sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('application/task does not import application/hooks, and the layer boundaries stay', async () => {
    const hooks = await messages("import { journalEntry } from '../hooks/journal-entry.js';\nexport const j = journalEntry;\n", 'src/application/task/x.ts');
    expect(hooks.map((m) => m.message).join('\n')).toContain('application/hooks');
    const layer = await messages("import { appendLine } from '../../infrastructure/fs/jsonl.js';\nexport const a = appendLine;\n", 'src/application/task/x.ts');
    expect(layer.map((m) => m.message).join('\n')).toContain('Layer boundary');
    const fromHooks = await messages("import { TaskMeasurement } from '../task/task-measurement.js';\nexport const t = TaskMeasurement;\n", 'src/application/hooks/x.ts');
    expect(fromHooks).toEqual([]);
  });

  it('node:path is not imported in application', async () => {
    for (const name of ['node:path', 'path']) {
      const found = await messages(`import { join } from '${name}';\nexport const j = join;\n`, 'src/application/project/x.ts');
      expect(found.map((m) => m.message).join('\n'), name).toContain('port');
    }
  });

  it('a file over 400 lines and a function over 80 lines are errors', async () => {
    const sizes = async (code: string, file: string) => (await messages(code, file)).map((m) => m.ruleId).filter((id) => id?.startsWith('max-lines'));
    expect(await sizes(`${lines(400)}\n`, 'src/domain/x.ts')).toEqual([]);
    expect(await sizes(`${lines(401)}\n`, 'src/domain/x.ts')).toEqual(['max-lines']);
    expect(await sizes(longFunction(77), 'src/application/x.ts')).toEqual([]);
    expect(await sizes(longFunction(78), 'src/application/x.ts')).toEqual(['max-lines-per-function']);
  });

  it('the whole of src passes with the list of debt', async () => {
    const results = await eslint(guardrails.DEBT).lintFiles(['src']);
    const errors = results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.message}`));
    expect(errors).toEqual([]);
  }, 120_000);
});

describe('the list of debt', () => {
  const without = (change: (debt: Debt) => void): Debt => {
    const debt = structuredClone(guardrails.DEBT);
    change(debt);
    return debt;
  };
  const lintFile = async (file: string, debt: Debt) => (await eslint(debt).lintFiles([join(ROOT, file)]))[0]?.messages ?? [];

  it('every listed file breaks its rule exactly as many times as listed', async () => {
    const lists: [keyof Pick<Debt, 'statusLiteral' | 'taskImportsHooks' | 'nodePath'>, RegExp][] = [
      ['statusLiteral', /task status/],
      ['taskImportsHooks', /application\/hooks/],
      ['nodePath', /node:path/],
    ];
    for (const [list, message] of lists) {
      for (const [file, count] of Object.entries(guardrails.DEBT[list])) {
        const found = await lintFile(file, without((debt) => delete debt[list][file]));
        const actual = found.filter((m) => message.test(m.message)).length;
        expect(actual, `${file}: set DEBT.${list} to ${actual} (0 means remove it)`).toBe(count);
      }
    }
  }, 120_000);

  it('every ceiling equals the current size', async () => {
    const sizes: [keyof Pick<Debt, 'maxLines' | 'maxFunctionLines'>, string][] = [
      ['maxLines', 'max-lines'],
      ['maxFunctionLines', 'max-lines-per-function'],
    ];
    for (const [list, rule] of sizes) {
      for (const [file, ceiling] of Object.entries(guardrails.DEBT[list])) {
        const found = await lintFile(file, without((debt) => delete debt[list][file]));
        const largest = Math.max(0, ...found.filter((m) => m.ruleId === rule).map((m) => Number(/\((\d+)\)/.exec(m.message)?.[1] ?? 0)));
        expect(largest, `${file}: set DEBT.${list} to ${largest} (0 means remove it)`).toBe(ceiling);
      }
    }
  }, 120_000);
});
