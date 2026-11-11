/** One call of an installed hook, as the process received it. */
export interface HookCall {
  readonly source: string | undefined;
  readonly event: string | undefined;
  /** Raw stdin of the hook. */
  readonly payload: string;
  /** Directory the hook process runs in. */
  readonly cwd: string;
  /** Project root the tool reports in its environment (`CLAUDE_PROJECT_DIR`), if any. */
  readonly projectDir?: string;
}
