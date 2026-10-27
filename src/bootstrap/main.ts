#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { runCli } from '../interface/cli/program.js';
import { createContainer, processEnvironment } from './container.js';

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

const container = createContainer(processEnvironment());
const invokedAs = basename(process.argv[1] ?? 'emt').replace(/\.js$/, '');

process.exitCode = await runCli(process.argv.slice(2), {
  name: invokedAs === 'estimetry' ? 'estimetry' : 'emt',
  version: packageVersion(),
  app: container.app,
  errors: container.errors,
  out: {
    print: (text) => process.stdout.write(`${text}\n`),
    error: (text) => process.stderr.write(`${text}\n`),
  },
});
