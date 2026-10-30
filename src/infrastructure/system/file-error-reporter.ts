import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ErrorReporter } from '../../application/ports/error-reporter.js';

/** Hooks run on every tool call, so a lasting failure must not grow the log without bound. */
export const ERROR_LOG_LIMIT_BYTES = 1024 * 1024;

/** Appends unexpected errors to `errors.log`. A failure to log is swallowed: reporting must never break the caller. */
export class FileErrorReporter implements ErrorReporter {
  constructor(
    readonly file: string,
    private readonly limitBytes = ERROR_LOG_LIMIT_BYTES,
  ) {}

  report(context: string, error: unknown): void {
    try {
      const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
      mkdirSync(dirname(this.file), { recursive: true });
      this.rotate();
      appendFileSync(this.file, `${new Date().toISOString()} [${context}] ${indent(detail)}\n`, 'utf8');
    } catch {
      // Nothing sensible left to do.
    }
  }

  /** Past the limit the log becomes `errors.log.1`, replacing the previous one. */
  private rotate(): void {
    try {
      if (statSync(this.file).size > this.limitBytes) {
        renameSync(this.file, `${this.file}.1`);
      }
    } catch {
      // No log yet.
    }
  }
}

function indent(text: string): string {
  return text.replace(/\n/g, '\n    ');
}
