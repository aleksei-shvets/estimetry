/**
 * A skill of estimetry named in a text for the agent, before the tool is known: the context of hooks and the
 * bodies of skills mention a skill with this mark, and the tool's adapter turns it into the way its agent calls
 * skills (`/emt-extra` in Claude Code, `$emt-extra` in Codex). One rule for every text.
 */
export function skillMention(id: string): string {
  return `{{skill:${id}}}`;
}

const MENTION = /\{\{skill:([a-z][a-z0-9-]*)\}\}/g;

/** The text with every mention of a skill named by `skillRef`. */
export function nameSkills(text: string, skillRef: (id: string) => string): string {
  return text.replace(MENTION, (_mark, id: string) => skillRef(id));
}

/** Where a body of a skill takes the arguments the user gave with it. */
export const ARGUMENTS_MENTION = '{{arguments}}';

/** A body of a skill in a tool's form: its skills named by `skillRef`, its arguments as `args`. */
export function renderBody(body: string, skillRef: (id: string) => string, args: string): string {
  return nameSkills(body, skillRef).replaceAll(ARGUMENTS_MENTION, args);
}
