#!/usr/bin/env node
import { basename } from 'node:path';
import { runCli } from '../interface/cli/program.js';
import { createContainer, packageVersion, processEnvironment } from './container.js';

const container = createContainer(processEnvironment());
const invokedAs = basename(process.argv[1] ?? 'emt').replace(/\.js$/, '');

process.exitCode = await runCli(process.argv.slice(2), {
  name: invokedAs === 'estimetry' ? 'estimetry' : 'emt',
  version: packageVersion(),
  app: container.app,
  hooks: container.hooks,
  errors: container.errors,
  terminal: {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !('CI' in process.env),
    input: process.stdin,
    output: process.stdout,
  },
  out: {
    print: (text) => process.stdout.write(`${text}\n`),
    error: (text) => process.stderr.write(`${text}\n`),
  },
});
