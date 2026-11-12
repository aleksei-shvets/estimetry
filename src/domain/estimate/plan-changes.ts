/*
 * The changes of a plan are the groups of the parts of its estimate: one rule
 * for the estimate as a value object and for its data in a snapshot.
 */

/** A part as either form has it: only its group matters here. */
interface Grouped {
  readonly group?: string | undefined;
}

/** The groups of the parts, each once, in the order of the parts. */
export function groupsOf(parts: readonly Grouped[] | undefined): string[] {
  return [...new Set((parts ?? []).flatMap((part) => (part.group === undefined ? [] : [part.group])))];
}
