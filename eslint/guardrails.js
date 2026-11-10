// @ts-check
/**
 * Architecture checks beyond the layer boundaries, and the list of debt: the
 * violations that existed when a check was introduced. The list only shrinks.
 * A fixed violation must leave the list, and a smaller file must lower its
 * ceiling (test/lint/guardrails.test.ts checks both). See CLAUDE.md, "Architecture".
 */

/** The statuses of a task, as in src/domain/task/task-status.ts (the test keeps them equal). */
export const TASK_STATUS_VALUES = ['new', 'estimated', 'in-progress', 'closed'];

/**
 * @typedef {object} Debt
 * @property {string[]} statusLiteral files of src/application comparing a task status with a string
 * @property {string[]} taskImportsHooks files of src/application/task importing src/application/hooks
 * @property {string[]} nodePath files of src/application importing node:path
 * @property {Record<string, number>} maxLines files over 400 lines, with their current length as the ceiling
 * @property {Record<string, number>} maxFunctionLines files with a function over 80 lines, with the longest one as the ceiling
 */

/** @type {Debt} */
export const DEBT = {
  statusLiteral: [
    'src/application/hooks/bind-session.ts',
    'src/application/hooks/receive-hook.ts',
    'src/application/hooks/session-task.ts',
    'src/application/task/list-tasks.ts',
    'src/application/task/record-retro.ts',
    'src/application/task/resolve-active-task.ts',
    'src/application/task/show-task.ts',
    'src/application/task/task-cards.ts',
  ],
  taskImportsHooks: [
    'src/application/task/attach-task.ts',
    'src/application/task/import-session-logs.ts',
    'src/application/task/revise-estimate.ts',
    'src/application/task/start-task.ts',
    'src/application/task/task-closing.ts',
  ],
  nodePath: ['src/application/hooks/flow-plans.ts', 'src/application/project/init-project.ts', 'src/application/project/stack.ts'],
  maxLines: {
    'src/domain/card/card.ts': 422,
    'src/domain/measurement/effort-calculator.ts': 935,
    'src/domain/progress/progress-records.ts': 440,
    'src/domain/task/task.ts': 927,
    'src/interface/cli/presenters/text-presenter.ts': 594,
  },
  maxFunctionLines: {
    'src/application/estimetry.ts': 92,
    'src/application/task/show-status.ts': 93,
    'src/bootstrap/container.ts': 150,
    'src/domain/card/card.ts': 157,
    'src/domain/measurement/effort-calculator.ts': 158,
    'src/domain/progress/part-facts.ts': 136,
    'src/domain/progress/progress-records.ts': 99,
    'src/domain/task/task.ts': 103,
    'src/infrastructure/persistence/records.ts': 102,
    'src/interface/cli/commands/close-commands.ts': 108,
    'src/interface/cli/commands/estimate-command.ts': 82,
  },
};

const MAX_LINES = 400;
const MAX_FUNCTION_LINES = 80;

const STATUS_VALUE = `/^(${TASK_STATUS_VALUES.join('|')})$/`;
const STATUS_MESSAGE =
  'Compare a task status through a method of the aggregate (Task) or a function of domain/task/task-status.ts, not with a string (see CLAUDE.md, "Architecture").';

/** `status` on one side of an equality, a task status literal on the other, in either order and through `?.`. */
const statusSelectors = ['left', 'right'].flatMap((side) => {
  const other = side === 'left' ? 'right' : 'left';
  const equality = `BinaryExpression[operator=/^[!=]==?$/][${other}.type='Literal'][${other}.value=${STATUS_VALUE}]`;
  return [
    `${equality}[${side}.type='MemberExpression'][${side}.property.name='status']`,
    `${equality}[${side}.type='ChainExpression'][${side}.expression.property.name='status']`,
    `${equality}[${side}.type='Identifier'][${side}.name='status']`,
  ];
});

/** @param {Debt} debt */
function statusRule(debt) {
  return [
    {
      files: ['src/application/**'],
      ignores: debt.statusLiteral,
      rules: { 'no-restricted-syntax': ['error', ...statusSelectors.map((selector) => ({ selector, message: STATUS_MESSAGE }))] },
    },
  ];
}

/** @param {Debt} debt */
function sizeRules(debt) {
  /** @param {number} max */
  const lines = (max) => ['error', { max, skipBlankLines: false, skipComments: false }];
  /** @param {number} max */
  const functionLines = (max) => ['error', { max, skipBlankLines: false, skipComments: false, IIFEs: true }];
  return [
    { files: ['src/**'], rules: { 'max-lines': lines(MAX_LINES), 'max-lines-per-function': functionLines(MAX_FUNCTION_LINES) } },
    ...Object.entries(debt.maxLines).map(([file, max]) => ({ files: [file], rules: { 'max-lines': lines(max) } })),
    ...Object.entries(debt.maxFunctionLines).map(([file, max]) => ({ files: [file], rules: { 'max-lines-per-function': functionLines(max) } })),
  ];
}

/** Imports of application/hooks from application/task: the dependency goes hooks → task only. */
export const TASK_IMPORTS_HOOKS = {
  regex: '(^|/)hooks/',
  message: 'application/task must not import application/hooks: the dependency goes hooks → task only (see CLAUDE.md, "Architecture").',
};

/** node:path in application: paths depend on the platform and go through ports. */
export const NODE_PATH = ['node:path', 'path', 'node:path/posix', 'node:path/win32'].map((name) => ({
  name,
  message: 'application must not import node:path: operations on paths go through a port (see CLAUDE.md, "Architecture").',
}));

/**
 * The import restrictions of src/application, one object per kind of file:
 * flat config replaces a rule's options instead of merging them, so a file of
 * the debt gets the full list without its own restriction, never less.
 *
 * @param {Debt} debt
 * @param {{ patterns: object[], paths: object[] }} boundary the layer boundary of application
 */
export function applicationImports(debt, boundary) {
  /** @param {string | undefined} file */
  const restrictions = (file) => {
    const inTask = file === undefined || file.startsWith('src/application/task/');
    return {
      patterns: [...boundary.patterns, ...(inTask && !debt.taskImportsHooks.includes(file ?? '') ? [TASK_IMPORTS_HOOKS] : [])],
      paths: [...boundary.paths, ...(debt.nodePath.includes(file ?? '') ? [] : NODE_PATH)],
    };
  };
  const base = { patterns: boundary.patterns, paths: [...boundary.paths, ...NODE_PATH] };
  const debtFiles = [...new Set([...debt.taskImportsHooks, ...debt.nodePath])];
  return [
    { files: ['src/application/**'], rules: { 'no-restricted-imports': ['error', base] } },
    { files: ['src/application/task/**'], rules: { 'no-restricted-imports': ['error', restrictions(undefined)] } },
    ...debtFiles.map((file) => ({ files: [file], rules: { 'no-restricted-imports': ['error', restrictions(file)] } })),
  ];
}

/** @param {Debt} debt */
export function guardrails(debt) {
  return [...statusRule(debt), ...sizeRules(debt)];
}
