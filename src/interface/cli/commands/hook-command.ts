import type { Command } from 'commander';
import type { ErrorReporter } from '../../../application/ports/error-reporter.js';
import type { CliContext } from '../cli-context.js';

/** Long enough for any hook payload; a stdin nobody closes must not hold the agent up. */
const STDIN_TIMEOUT_MS = 2_000;

/**
 * Entry point of installed hooks. Never fails and never prints: an error ends up
 * in errors.log and the exit code stays 0, so a hook cannot break the session.
 */
export function registerHookCommand(program: Command, ctx: CliContext & { readonly errors: ErrorReporter }): void {
  program
    .command('hook', { hidden: true })
    .argument('[source]')
    .argument('[event]')
    .allowExcessArguments()
    .allowUnknownOption()
    .helpOption(false)
    .action(async (source: string | undefined, event: string | undefined, _options: unknown, command: Command) => {
      try {
        const payload = await readStdin(ctx.terminal.input);
        if (command.args.length > 2) {
          throw new Error(`unexpected hook arguments: ${command.args.slice(2).join(' ')}`);
        }
        (await ctx.hooks()).receive({ source, event, payload });
      } catch (error) {
        ctx.errors.report(`hook ${source ?? ''} ${event ?? ''}`.trim(), error);
      }
    });
}

/** All of stdin, or nothing when it is a terminal (run by hand). */
function readStdin(input: NodeJS.ReadableStream & { readonly isTTY?: boolean }): Promise<string> {
  if (input.isTTY) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    let data = '';
    const onData = (chunk: string): void => {
      data += chunk;
    };
    const done = (): void => {
      clearTimeout(timer);
      input.off('data', onData);
      input.off('end', done);
      input.off('error', done);
      // A stdin nobody closes would keep the process alive after the hook is done.
      (input as { destroy?: () => void }).destroy?.();
      resolve(data);
    };
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    input.setEncoding?.('utf8');
    input.on('data', onData);
    input.on('end', done);
    input.on('error', done);
  });
}
