/*
 * The tables `[hooks.state."<key>"]` of the user config of Codex, read and written by lines (codex-install spec,
 * "Одобрение хуков Codex"). The rest of the file stays byte for byte: its comments, order and line endings. A file
 * whose shape lines cannot handle safely — `hooks` or `state` as an inline table or a dotted key, multi-line strings,
 * a table of ours defined twice — is refused: no trust is written, and the user trusts the hooks in `/hooks`.
 */

const UNSAFE = [/^\s*(hooks|state)\s*=/, /^\s*(hooks\s*\.\s*)?state\s*\./, /^\s*hooks\s*\./];

export interface StateTable {
  readonly trustedHash?: string;
  /** The `enabled` line the user wrote, as it is. */
  readonly enabled?: string;
}

/** The table of a key, if the config has it; undefined for a config lines cannot read safely too. */
export function stateTable(config: string | undefined, key: string): StateTable | undefined {
  const lines = linesOf(config ?? '');
  if (lines === undefined) {
    return undefined;
  }
  const found = tablesOf(lines, key);
  const [only] = found;
  return only === undefined || found.length > 1 ? undefined : bodyFacts(lines.slice(only.start + 1, only.end));
}

/** The config with our tables written anew at its end, each keeping its `enabled`; undefined when it is refused. */
export function withStateTables(config: string | undefined, tables: readonly { key: string; trustedHash: string }[]): string | undefined {
  const text = config ?? '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = linesOf(text);
  if (lines === undefined) {
    return undefined;
  }
  const written: string[] = [];
  for (const table of tables) {
    const found = tablesOf(lines, table.key);
    if (found.length > 1) {
      return undefined; // a table defined twice is no TOML: Codex itself would refuse the file
    }
    const [current] = found;
    const enabled = current === undefined ? undefined : bodyFacts(lines.slice(current.start + 1, current.end)).enabled;
    if (current !== undefined) {
      lines = [...lines.slice(0, current.start), ...lines.slice(current.end)];
    }
    written.push([header(table.key), ...(enabled === undefined ? [] : [enabled]), `trusted_hash = "${table.trustedHash}"`].join(eol));
  }
  const body = lines.join(eol).replace(/(\r?\n){3,}/g, `${eol}${eol}`).replace(/(\r?\n)+$/, '');
  return `${body === '' ? '' : `${body}${eol}${eol}`}${written.join(`${eol}${eol}`)}${eol}`;
}

/** The lines of a config lines can handle, or undefined. */
function linesOf(config: string): string[] | undefined {
  if (config.includes('"""') || config.includes("'''")) {
    return undefined;
  }
  const lines = config === '' ? [] : config.split(/\r?\n/);
  return lines.some((line) => !isComment(line) && UNSAFE.some((unsafe) => unsafe.test(line))) ? undefined : lines;
}

/** Each table of the key: its header line and the line where the next table starts. */
function tablesOf(lines: readonly string[], key: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  lines.forEach((line, start) => {
    if (sameKey(headerKey(line), ['hooks', 'state', key])) {
      const next = lines.findIndex((other, i) => i > start && headerKey(other) !== undefined);
      found.push({ start, end: next < 0 ? lines.length : next });
    }
  });
  return found;
}

function bodyFacts(body: readonly string[]): StateTable {
  const live = body.filter((line) => !isComment(line));
  const hash = live.map((line) => /^\s*trusted_hash\s*=\s*"([^"]*)"/.exec(line)?.[1]).find((value) => value !== undefined);
  const enabled = live.find((line) => /^\s*enabled\s*=/.test(line))?.trim();
  return { ...(hash === undefined ? {} : { trustedHash: hash }), ...(enabled === undefined ? {} : { enabled }) };
}

/** The key of a table header line (`[a.b."c"]`, with spaces, quotes of both kinds, a comment after); not of `[[…]]`. */
function headerKey(line: string): string[] | undefined {
  const match = /^\s*\[(?!\[)(.*)\]\s*(#.*)?$/.exec(line);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const parts: string[] = [];
  const key = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(\.|$)/y;
  let rest = match[1];
  while (rest !== '') {
    key.lastIndex = 0;
    const part = key.exec(rest);
    if (part === null) {
      return undefined;
    }
    parts.push(part[1] !== undefined ? part[1].replace(/\\(["\\])/g, '$1') : (part[2] ?? part[3] ?? ''));
    rest = rest.slice(part[0].length);
  }
  return parts;
}

function sameKey(found: readonly string[] | undefined, wanted: readonly string[]): boolean {
  return found !== undefined && found.length === wanted.length && found.every((part, i) => part === wanted[i]);
}

function header(key: string): string {
  return `[hooks.state."${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;
}

function isComment(line: string): boolean {
  return /^\s*#/.test(line);
}
