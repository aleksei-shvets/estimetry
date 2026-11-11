#!/usr/bin/env node
import { basename } from 'node:path';
import { createContainer, processEnvironment } from './container.js';

// The moment the process started: the time of the events a hook writes, before modules take their load time.
const container = createContainer(processEnvironment(), { startedAt: performance.timeOrigin });
const args = process.argv.slice(2);
const terminal = {
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !('CI' in process.env),
  input: process.stdin,
  output: process.stdout,
};
const out = {
  print: (text: string) => process.stdout.write(`${text}\n`),
  error: (text: string) => process.stderr.write(`${text}\n`),
};

if (args[0] === 'hook') {
  // Hooks run on every tool call: skip the CLI parser and every command.
  const { runHook } = await import('../interface/cli/commands/hook-command.js');
  process.exitCode = await runHook(args.slice(1), {
    hooks: container.hooks,
    errors: container.errors,
    terminal,
    out,
    cwd: process.cwd(),
    ...(process.env['CLAUDE_PROJECT_DIR'] === undefined ? {} : { projectDir: process.env['CLAUDE_PROJECT_DIR'] }),
  });
} else {
  const [{ runCli }, { packageVersion }] = await Promise.all([import('../interface/cli/program.js'), import('./container.js')]);
  const invokedAs = basename(process.argv[1] ?? 'emt').replace(/\.js$/, '');
  process.exitCode = await runCli(args, {
    name: invokedAs === 'estimetry' ? 'estimetry' : 'emt',
    version: packageVersion(),
    app: container.app,
    hooks: container.hooks,
    errors: container.errors,
    terminal,
    out,
    cwd: process.cwd(),
  });
}
