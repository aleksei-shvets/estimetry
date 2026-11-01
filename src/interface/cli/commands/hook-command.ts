import type { ErrorReporter } from '../../../application/ports/error-reporter.js';
import type { CliContext } from '../cli-context.js';

/** Long enough for any hook payload; a stdin nobody closes must not hold the agent up. */
const STDIN_TIMEOUT_MS = 2_000;

export interface HookRun {
  readonly hooks: CliContext['hooks'];
  readonly errors: ErrorReporter;
  readonly terminal: CliContext['terminal'];
  readonly out: CliContext['out'];
  /** Directory of the process and `CLAUDE_PROJECT_DIR`, if the tool set it. */
  readonly cwd: string;
  readonly projectDir?: string;
}

/**
 * `estimetry hook <source> <event>`, run before the CLI parser so a hook loads
 * as little as possible. Never fails: any error goes to errors.log, the exit
 * code stays 0, and only the context for the agent is printed.
 */
export async function runHook(args: readonly string[], run: HookRun): Promise<number> {
  const [source, event, ...extra] = args;
  try {
    const payload = await readStdin(run.terminal.input);
    if (extra.length > 0) {
      throw new Error(`unexpected hook arguments: ${extra.length} more than <source> <event>`);
    }
    const output = await (await run.hooks()).receive({
      source,
      event,
      payload,
      cwd: run.cwd,
      ...(run.projectDir === undefined || run.projectDir === '' ? {} : { projectDir: run.projectDir }),
    });
    if (output !== undefined) {
      run.out.print(output);
    }
  } catch (error) {
    run.errors.report(`hook ${source ?? ''} ${event ?? ''}`.trim(), error);
  }
  return 0;
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
