// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { AGGREGATE_INTERNALS, DEBT, applicationImports, guardrails } from './eslint/guardrails.js';

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
    'no-restricted-imports': ['error', { patterns: [...patterns, AGGREGATE_INTERNALS], paths }],
  },
});

/** Directories of AI tools and commit sources under integrations/tools; a test keeps the list equal to the disk. */
export const TOOL_DIRS = ['claude-code', 'codex', 'git'];

/** @param {string[]} dirs */
const toolImports = (dirs) => ({
  regex: `(^|/)(${dirs.join('|')})/`,
  message: `Tools boundary: an adapter imports no other tool (${dirs.join(', ')}); share code through tools/shared (see CLAUDE.md, "Architecture").`,
});

/** The patterns every file of integrations/tools obeys. */
const toolsBase = [
  layerImports(['infrastructure', 'interface', 'bootstrap']),
  {
    regex: '(^|/)(flows|stack)/',
    message: 'Integrations boundary: integrations/tools must not import flows, stack (see CLAUDE.md, "Architecture").',
  },
];

/** Each tool directory may not import the others; the registries at the top import none: bootstrap registers adapters. */
const toolBoundaries = () => [
  ...TOOL_DIRS.map((own) =>
    boundary(`src/integrations/tools/${own}/**`, [...toolsBase, toolImports(TOOL_DIRS.filter((dir) => dir !== own))]),
  ),
  boundary('src/integrations/tools/*.ts', [...toolsBase, toolImports(TOOL_DIRS)]),
];

const nodeIo = ['node:fs', 'node:fs/promises', 'node:child_process', 'fs', 'fs/promises', 'child_process'];

/**
 * The configuration with a given list of debt; the tests of the guardrails build it without an entry.
 * @param {import('./eslint/guardrails.js').Debt} debt
 */
export const config = (debt) =>
  tseslint.config(
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
    ...applicationImports(debt, {
      patterns: [layerImports(allExcept('domain', 'application')), AGGREGATE_INTERNALS],
      paths: nodeIo.map((name) => ({
        name,
        message: 'Layer boundary: application performs I/O only through ports (see CLAUDE.md, "Architecture").',
      })),
    }),
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
    ...toolBoundaries(),
    boundary('src/integrations/*.ts', [layerImports(['infrastructure', 'interface', 'bootstrap'])]),
    boundary('src/interface/**', [layerImports(['infrastructure', 'integrations', 'bootstrap'])]),
    // The composition root may import every layer, but not the inside of the aggregate.
    boundary('src/bootstrap/**', []),

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
        // `new Date()` is forbidden by the restricted syntax of eslint/guardrails.js, together with casts.
      },
    },
    ...guardrails(debt),
  );

export default config(DEBT);
