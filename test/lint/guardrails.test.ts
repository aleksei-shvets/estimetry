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
  maxParams: Record<string, number>;
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

  it('a cast to Timestamp is an error anywhere in src, another cast is not', async () => {
    const cast = "import type { Timestamp } from '../../domain/shared/timestamp.js';\ndeclare const task: { startedAt: Timestamp | undefined };\nexport const s = task.startedAt as Timestamp;\n";
    const inApplication = await messages(cast, 'src/application/task/x.ts');
    expect(inApplication.map((m) => m.message).join('\n')).toMatch(/requireStartedAt/);
    const inDomain = await messages(cast.replace('../../domain/shared/', '../shared/'), 'src/domain/progress/x.ts');
    expect(inDomain.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
    // The status selectors of application stay next to the cast in the same rule.
    const both = await messages(`${cast}declare const status: string;\nexport const c = status === 'closed';\n`, 'src/application/task/x.ts');
    expect(both.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(2);
    const other = await messages('declare const value: unknown;\nexport const s = value as string;\n', 'src/application/task/x.ts');
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

  it('a function of application with more than six parameters is an error', async () => {
    const params = (count: number) => Array.from({ length: count }, (_, i) => `p${i}: number`).join(', ');
    const constructor = (count: number) => `export class X {\n  constructor(${params(count).replaceAll('p', 'private readonly p')}) {}\n}\n`;
    const rules = async (code: string) => (await messages(code, 'src/application/task/x.ts')).map((m) => m.ruleId).filter((id) => id === 'max-params');
    expect(await rules(constructor(7))).toEqual(['max-params']);
    expect(await rules(constructor(6))).toEqual([]);
    expect(await rules(`export function f(${params(6)}): number {\n  return p0 + p1 + p2 + p3 + p4 + p5;\n}\n`)).toEqual([]);
  });

  it('the inside of the Task aggregate is imported only from src/domain/task', async () => {
    const restricted = async (code: string, file: string) => (await messages(code, file)).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
    const state = "import type { TaskState } from '../task/task-state.js';\nexport type S = TaskState;\n";
    expect((await restricted(state, 'src/domain/card/x.ts')).join('\n')).toMatch(/internal to src\/domain\/task/);
    expect(await restricted("import { applyEvent } from '../../domain/task/task-apply.js';\nexport const a = applyEvent;\n", 'src/application/task/x.ts')).toHaveLength(1);
    expect(await restricted("import { applyRevision } from '../domain/task/task-revisions.js';\nexport const a = applyRevision;\n", 'src/bootstrap/x.ts')).toHaveLength(1);
    expect(await restricted("import type { TaskState } from '../../domain/task/task-state.js';\nexport type S = TaskState;\n", 'src/infrastructure/persistence/x.ts')).toHaveLength(1);
    expect(await restricted("import type { TaskState } from './task-state.js';\nexport type S = TaskState;\n", 'src/domain/task/x.ts')).toEqual([]);
    expect(await restricted("import type { TaskSnapshot } from '../../domain/task/task-snapshot.js';\nexport type S = TaskSnapshot;\n", 'src/infrastructure/persistence/x.ts')).toEqual([]);
  });

  it('an object of more than six dependencies in application is an error, except the ports of the facade', async () => {
    const fields = (count: number) => Array.from({ length: count }, (_, i) => `readonly d${i}: number;`).join(' ');
    const errors = async (code: string, file = 'src/application/hooks/x.ts') =>
      (await messages(code, file)).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
    expect((await errors(`export interface HookDependencies { ${fields(7)} }\n`)).join('\n')).toMatch(/group|by meaning/);
    expect(await errors(`export class X {\n  constructor(private readonly deps: { ${fields(7)} }) {}\n}\n`, 'src/application/task/x.ts')).toHaveLength(1);
    expect(await errors(`export interface InstallDependencies { ${fields(6)} }\n`, 'src/application/project/x.ts')).toEqual([]);
    expect(await errors(`export class X {\n  constructor(private readonly deps: { ${fields(6)} }) {}\n}\n`, 'src/application/task/x.ts')).toEqual([]);
    expect(await errors(`export interface EstimetryDependencies { ${fields(27)} }\n`, 'src/application/estimetry.ts')).toEqual([]);
    expect(await errors(`export interface CardFields { ${fields(9)} }\n`, 'src/application/task/x.ts')).toEqual([]);
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
    const sizes: [keyof Pick<Debt, 'maxLines' | 'maxFunctionLines' | 'maxParams'>, string][] = [
      ['maxLines', 'max-lines'],
      ['maxFunctionLines', 'max-lines-per-function'],
      ['maxParams', 'max-params'],
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
