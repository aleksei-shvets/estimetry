/** Records unexpected errors for later diagnosis. Must never throw. */
export interface ErrorReporter {
  report(context: string, error: unknown): void;
}
