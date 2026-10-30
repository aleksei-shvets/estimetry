/**
 * A skill or command as the user sees it, independent of the AI tool: the
 * tool adapter decides the path and the frontmatter (as in OpenSpec's
 * command-generation).
 */
export interface CommandContent {
  /** Also the name the user types: `emt-start` → `/emt-start`. */
  readonly id: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly body: string;
}
