// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const LAYERS = ['domain', 'application', 'infrastructure', 'integrations', 'interface', 'bootstrap'];

/**
 * Forbids relative imports that reach into the given layers.
 * @param {string[]} layers
 */
const layerImports = (layers) => ({
  regex: `(^|/)(${layers.join('|')})(/|$)`,
  message: `Layer boundary: this layer must not import from ${layers.join(', ')} (see CLAUDE.md, "Architecture").`,
});

/** @param {string} layer */
const allExcept = (...layer) => LAYERS.filter((l) => !layer.includes(l));

/**
 * @param {string} files
 * @param {object[]} patterns
 * @param {string[]} [paths]
 */
const boundary = (files, patterns, paths = []) => ({
  files: [files],
  rules: {
    'no-restricted-imports': ['error', { patterns, paths }],
  },
});

const nodeIo = ['node:fs', 'node:fs/promises', 'node:child_process', 'fs', 'fs/promises', 'child_process'];

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  boundary('src/domain/**', [
    layerImports(allExcept('domain')),
    {
      regex: '^(?!\\.{1,2}/)',
      message: 'Layer boundary: domain must not import packages or Node built-ins (see CLAUDE.md, "Architecture").',
    },
  ]),
  boundary(
    'src/application/**',
    [layerImports(allExcept('domain', 'application'))],
    nodeIo.map((name) => ({
      name,
      message: 'Layer boundary: application performs I/O only through ports (see CLAUDE.md, "Architecture").',
    })),
  ),
  boundary('src/infrastructure/**', [layerImports(['integrations', 'interface', 'bootstrap'])]),
  // Integrations also stay apart from each other: a tool adapter knows no flow, a flow no stack detector.
  ...[
    ['tools', ['flows', 'stack']],
    ['flows', ['tools', 'stack']],
    ['stack', ['tools', 'flows']],
  ].map(([own, others]) =>
    boundary(`src/integrations/${own}/**`, [
      layerImports(['infrastructure', 'interface', 'bootstrap']),
      {
        regex: `(^|/)(${others.join('|')})/`,
        message: `Integrations boundary: integrations/${own} must not import ${others.join(', ')} (see CLAUDE.md, "Architecture").`,
      },
    ]),
  ),
  boundary('src/integrations/*.ts', [layerImports(['infrastructure', 'interface', 'bootstrap'])]),
  boundary('src/interface/**', [layerImports(['infrastructure', 'integrations', 'bootstrap'])]),

  {
    files: ['src/domain/**', 'src/application/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Pass configuration through ports instead of reading process state.' },
      ],
    },
  },
  {
    files: ['src/domain/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Domain gets time from the caller (Clock port).' },
        { object: 'Math', property: 'random', message: 'Domain gets ids from the caller (IdGenerator port).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Domain gets time from the caller (Clock port).',
        },
      ],
    },
  },
);
