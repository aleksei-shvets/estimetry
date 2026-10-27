import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ErrorReporter } from '../../application/ports/error-reporter.js';

/** Appends unexpected errors to `errors.log`. A failure to log is swallowed: reporting must never break the caller. */
export class FileErrorReporter implements ErrorReporter {
  constructor(readonly file: string) {}

  report(context: string, error: unknown): void {
    try {
      const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${new Date().toISOString()} [${context}] ${indent(detail)}\n`, 'utf8');
    } catch {
      // Nothing sensible left to do.
    }
  }
}

function indent(text: string): string {
  return text.replace(/\n/g, '\n    ');
}
