import { CommanderError } from 'commander';
import type { ErrorReporter } from '../../application/ports/error-reporter.js';
import { DomainError } from '../../domain/shared/domain-error.js';
import type { CliOutput } from './cli-output.js';

export const ExitCode = {
  ok: 0,
  /** Bad arguments, unknown task, a rule of the domain refused the operation. */
  userError: 1,
  /** A bug or a broken environment; details go to errors.log. */
  internalError: 2,
} as const;

/** Turns any failure into an exit code and a one-line message without a stack trace. */
export function toExitCode(error: unknown, out: CliOutput, errors: ErrorReporter, context: string): number {
  if (error instanceof CommanderError) {
    // Commander has already printed its own message (or the help text).
    return error.exitCode === 0 ? ExitCode.ok : ExitCode.userError;
  }
  if (error instanceof DomainError) {
    out.error(`estimetry: ${error.message}`);
    return ExitCode.userError;
  }
  errors.report(context, error);
  const message = error instanceof Error ? error.message : String(error);
  out.error(`estimetry: unexpected error: ${message} (details in errors.log)`);
  return ExitCode.internalError;
}
