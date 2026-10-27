/** Where the CLI writes. Injected so tests and future clients can capture output. */
export interface CliOutput {
  /** Results: stdout. */
  print(text: string): void;
  /** Errors and warnings: stderr. */
  error(text: string): void;
}
