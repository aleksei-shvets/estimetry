/** One call of an installed hook, as the process received it. */
export interface HookCall {
  readonly source: string | undefined;
  readonly event: string | undefined;
  /** Raw stdin of the hook. */
  readonly payload: string;
  /** Directory the hook process runs in. */
  readonly cwd: string;
  /** The environment of the hook process: the adapter names the variable of its project root, if it has one. */
  readonly environment?: (name: string) => string | undefined;
}
