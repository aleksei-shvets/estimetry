import { createHash } from 'node:crypto';

const GENERATED_LINE = /^ {2}generatedBy: .*\n/m;
const HASH_LINE = /^ {2}contentHash: "[0-9a-f]*"\n/m;

/**
 * Frontmatter `metadata` of a file estimetry generates: `generatedBy` with the version. `stamp` puts
 * `contentHash` of the whole text after that line, so `ownership` can tell an untouched file from an edited one.
 */
export function generatedBy(version: string): string[] {
  return ['metadata:', `  generatedBy: "estimetry ${version}"`];
}

/** The text with the hash of itself after its `generatedBy` line. */
export function stamp(unhashed: string): string {
  return unhashed.replace(GENERATED_LINE, (line) => `${line}  contentHash: "${hashOf(unhashed)}"\n`);
}

export type Ownership = 'ours' | 'edited' | 'foreign';

/** Whose the file is: ours and untouched, ours but edited by the user, or the user's own. */
export function ownership(text: string): Ownership {
  if (!/^ {2}generatedBy: "estimetry /m.test(text)) {
    return 'foreign';
  }
  const stamped = /^ {2}contentHash: "([0-9a-f]*)"$/m.exec(text)?.[1];
  return stamped !== undefined && stamped === hashOf(text.replace(HASH_LINE, '')) ? 'ours' : 'edited';
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}
