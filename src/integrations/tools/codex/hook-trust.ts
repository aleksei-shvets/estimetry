import { createHash } from 'node:crypto';
import { ourHandlers, type HandlerPlace } from '../shared/hook-settings.js';

/*
 * The trust Codex keeps for a hook (codex-install spec, "Одобрение хуков Codex"): in the user config,
 * `[hooks.state."<hooks file>:<event in snake case>:<group>:<handler>"]` with `trusted_hash`. The hash is Codex's own
 * (`hook_hash` in codex-rs/hooks/src/engine/discovery.rs): SHA-256 of the compact JSON, keys sorted, of
 * `{event_name, matcher?, hooks: [the handler normalized]}`; checked against trusts Codex 0.162.1 wrote. estimetry
 * writes a trust only when the user agreed to it (`init --trust-hooks`, or a trust given before, at an upgrade).
 */

/** Codex's default timeout of a command hook, in seconds, when the file names none. */
const DEFAULT_TIMEOUT = 600;

export interface HookTrust {
  readonly key: string;
  readonly hash: string;
}

/** The trust each hook of ours in a hooks file needs: its key and the hash Codex computes for it. */
export function hookTrusts(hooksPath: string, hooksText: string | undefined, ours: string): HookTrust[] {
  return ourHandlers(hooksText, ours).map((place) => ({
    key: `${hooksPath}:${snakeCase(place.event)}:${place.group}:${place.handler}`,
    hash: trustHash(place),
  }));
}

/** Whether a hook of ours has no trust of Codex, or one of an earlier form of it. No config is no trust. */
export function untrustedHooks(config: string | undefined, trusts: readonly HookTrust[]): boolean {
  return trusts.some((trust) => trustedHashOf(config ?? '', trust.key) !== trust.hash);
}

/** Whether the user trusted a hook of ours in this file before, in any form: their consent, to keep at an upgrade. */
export function trustedBefore(config: string | undefined, trusts: readonly HookTrust[]): boolean {
  return trusts.some((trust) => trustedHashOf(config ?? '', trust.key) !== undefined);
}

/**
 * The config with a trust of every hook of ours: their tables written anew, `enabled` the user set kept, the rest of
 * the file as it was.
 */
export function withTrusts(config: string | undefined, trusts: readonly HookTrust[]): string {
  let text = config ?? '';
  const tables: string[] = [];
  for (const trust of trusts) {
    const { rest, enabled } = withoutTable(text, header(trust.key));
    text = rest;
    tables.push([header(trust.key), ...(enabled === undefined ? [] : [enabled]), `trusted_hash = "${trust.hash}"`].join('\n'));
  }
  const body = text.replace(/\n*$/, '');
  return `${body === '' ? '' : `${body}\n\n`}${tables.join('\n\n')}\n`;
}

function trustHash(place: HandlerPlace): string {
  const handler = place.config;
  const normalized = {
    type: 'command',
    command: handler['command'],
    ...(typeof handler['commandWindows'] === 'string' ? { commandWindows: handler['commandWindows'] } : {}),
    timeout: typeof handler['timeout'] === 'number' ? handler['timeout'] : DEFAULT_TIMEOUT,
    async: handler['async'] === true,
    ...(typeof handler['statusMessage'] === 'string' ? { statusMessage: handler['statusMessage'] } : {}),
  };
  const matcher = place.matcher === undefined ? {} : { matcher: place.matcher };
  const identity = { event_name: snakeCase(place.event), ...matcher, hooks: [normalized] };
  return `sha256:${createHash('sha256').update(JSON.stringify(sorted(identity))).digest('hex')}`;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sorted);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sorted(record[key])]));
  }
  return value;
}

function header(key: string): string {
  return `[hooks.state."${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;
}

/** The `trusted_hash` of a table, if the config has the table and the table has one. */
function trustedHashOf(config: string, key: string): string | undefined {
  const section = tableOf(config, header(key));
  return section === undefined ? undefined : /^\s*trusted_hash\s*=\s*"([^"]*)"/m.exec(section)?.[1];
}

/** The lines of a table after its header, up to the next table. */
function tableOf(config: string, head: string): string | undefined {
  const start = config.indexOf(`${head}\n`) >= 0 ? config.indexOf(`${head}\n`) : config.endsWith(head) ? config.length - head.length : -1;
  if (start < 0) {
    return undefined;
  }
  const body = config.slice(start + head.length);
  const next = body.search(/^\s*\[/m);
  return next < 0 ? body : body.slice(0, next);
}

/** The config without a table, and its `enabled` line if the user set one. */
function withoutTable(config: string, head: string): { rest: string; enabled?: string } {
  const section = tableOf(config, head);
  if (section === undefined) {
    return { rest: config };
  }
  const start = config.indexOf(head);
  const enabled = /^\s*enabled\s*=.*$/m.exec(section)?.[0]?.trim();
  const rest = `${config.slice(0, start)}${config.slice(start + head.length + section.length).replace(/^\n+/, '')}`;
  return { rest: rest.replace(/\n{3,}/g, '\n\n'), ...(enabled === undefined ? {} : { enabled }) };
}

/** `PreToolUse` → `pre_tool_use`, as Codex names events in the keys of trusts. */
function snakeCase(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
