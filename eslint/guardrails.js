// @ts-check
/**
 * Architecture checks beyond the layer boundaries, and the list of debt: the
 * violations that existed when a check was introduced. The list only shrinks.
 * A fixed violation must leave the list, and a smaller file must lower its
 * ceiling (test/lint/guardrails.test.ts checks both). A rule is off in a file of
 * the list, so the test also keeps the number of violations from growing. See CLAUDE.md, "Architecture".
 */

/** The statuses of a task, as in src/domain/task/task-status.ts (the test keeps them equal). */
export const TASK_STATUS_VALUES = ['new', 'estimated', 'in-progress', 'closed'];

/**
 * @typedef {object} Debt
 * @property {Record<string, number>} statusLiteral files of src/application comparing a task status with a string, with how many times
 * @property {Record<string, number>} taskImportsHooks files of src/application/task importing src/application/hooks, with how many imports
 * @property {Record<string, number>} nodePath files of src/application importing node:path, with how many imports
 * @property {Record<string, number>} maxLines files over 400 lines, with their current length as the ceiling
 * @property {Record<string, number>} maxFunctionLines files with a function over 80 lines, with the longest one as the ceiling
 * @property {Record<string, number>} maxParams files of src/application with a function over 6 parameters, with the most as the ceiling
 */

/** @type {Debt} */
export const DEBT = {
  statusLiteral: {},
  taskImportsHooks: {},
  nodePath: {},
  maxLines: {
    'src/domain/progress/progress-records.ts': 440,
    'src/domain/task/task.ts': 613,
  },
  maxFunctionLines: {
    'src/application/task/show-status.ts': 93,
    'src/bootstrap/container.ts': 125,
    'src/domain/progress/part-facts.ts': 136,
    'src/domain/progress/progress-records.ts': 99,
    'src/infrastructure/persistence/records.ts': 102,
    'src/interface/cli/commands/close-commands.ts': 108,
    'src/interface/cli/commands/estimate-command.ts': 82,
  },
  maxParams: {},
};

const MAX_LINES = 400;
const MAX_FUNCTION_LINES = 80;
const MAX_PARAMS = 6;

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

const TIMESTAMP_CAST = {
  selector: "TSAsExpression[typeAnnotation.typeName.name='Timestamp']",
  message:
    'Do not cast to Timestamp: use a narrow getter that checks the moment (requireStartedAt(), requireClosedAt()) or a method of the value object (ManualTime.interval()).',
};

const NEW_DATE = {
  selector: "NewExpression[callee.name='Date'][arguments.length=0]",
  message: 'Domain gets time from the caller (Clock port).',
};

/**
 * Restricted syntax: a cast to Timestamp in all of src, `new Date()` in domain, task statuses compared with a string in application.
 * Flat config replaces the options of a rule, so application and the files of the debt get the full list each.
 * @param {Debt} debt
 */
function syntaxRules(debt) {
  const status = statusSelectors.map((selector) => ({ selector, message: STATUS_MESSAGE }));
  const debtFiles = Object.keys(debt.statusLiteral);
  return [
    { files: ['src/**'], rules: { 'no-restricted-syntax': ['error', TIMESTAMP_CAST] } },
    { files: ['src/domain/**'], rules: { 'no-restricted-syntax': ['error', TIMESTAMP_CAST, NEW_DATE] } },
    { files: ['src/application/**'], ignores: debtFiles, rules: { 'no-restricted-syntax': ['error', TIMESTAMP_CAST, ...status] } },
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

/**
 * Positional parameters in application: more than six means an input object or dependencies grouped by meaning.
 * @param {Debt} debt
 */
function paramsRule(debt) {
  return [
    { files: ['src/application/**'], rules: { 'max-params': ['error', MAX_PARAMS] } },
    ...Object.entries(debt.maxParams).map(([file, max]) => ({ files: [file], rules: { 'max-params': ['error', max] } })),
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
      patterns: [...boundary.patterns, ...(inTask && !((file ?? '') in debt.taskImportsHooks) ? [TASK_IMPORTS_HOOKS] : [])],
      paths: [...boundary.paths, ...((file ?? '') in debt.nodePath ? [] : NODE_PATH)],
    };
  };
  const base = { patterns: boundary.patterns, paths: [...boundary.paths, ...NODE_PATH] };
  const debtFiles = [...new Set([...Object.keys(debt.taskImportsHooks), ...Object.keys(debt.nodePath)])];
  return [
    { files: ['src/application/**'], rules: { 'no-restricted-imports': ['error', base] } },
    { files: ['src/application/task/**'], rules: { 'no-restricted-imports': ['error', restrictions(undefined)] } },
    ...debtFiles.map((file) => ({ files: [file], rules: { 'no-restricted-imports': ['error', restrictions(file)] } })),
  ];
}

/** @param {Debt} debt */
export function guardrails(debt) {
  return [...syntaxRules(debt), ...sizeRules(debt), ...paramsRule(debt)];
}
