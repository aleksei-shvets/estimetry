import { createHash } from 'node:crypto';
import { ourHandlers, type HandlerPlace } from '../shared/hook-settings.js';
import { stateTable, withStateTables } from './trust-tables.js';

/*
 * The trust Codex keeps for a hook (codex-install spec, "Одобрение хуков Codex"): in the user config,
 * `[hooks.state."<hooks file>:<event in snake case>:<group>:<handler>"]` with `trusted_hash`. The hash is Codex's own
 * (`hook_hash` in codex-rs/hooks/src/engine/discovery.rs): SHA-256 of the compact JSON, keys sorted, of
 * `{event_name, matcher?, hooks: [the handler normalized]}`, normalized as Codex does it (`normalize_command_hook`,
 * `matcher_pattern_for_event`); checked against trusts Codex 0.162.1 wrote. estimetry writes a trust only with the
 * user's consent (codex-adapter.ts).
 */

/** Events whose matcher Codex keeps; for the others it has none. */
const MATCHED_EVENTS: ReadonlySet<string> = new Set([
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
]);
/** Codex waits for these at most 3 seconds, and 1 when the hook names no timeout. */
const SHORT_EVENTS: ReadonlySet<string> = new Set(['SessionEnd', 'Interrupt']);

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
  return trusts.some((trust) => stateTable(config, trust.key)?.trustedHash !== trust.hash);
}

/** The config with a trust of every hook of ours, the rest of it as it was; undefined when it cannot be changed safely. */
export function withTrusts(config: string | undefined, trusts: readonly HookTrust[]): string | undefined {
  return withStateTables(
    config,
    trusts.map((trust) => ({ key: trust.key, trustedHash: trust.hash })),
  );
}

function trustHash(place: HandlerPlace): string {
  const handler = place.config;
  const timeout = typeof handler['timeout'] === 'number' ? handler['timeout'] : undefined;
  const normalized = {
    type: 'command',
    command: handler['command'],
    timeout: SHORT_EVENTS.has(place.event) ? Math.min(Math.max(timeout ?? 1, 1), 3) : Math.max(timeout ?? 600, 1),
    async: handler['async'] === true,
    ...(typeof handler['statusMessage'] === 'string' ? { statusMessage: handler['statusMessage'] } : {}),
  };
  const matcher = place.matcher === undefined || !MATCHED_EVENTS.has(place.event) ? {} : { matcher: place.matcher };
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

/** `PreToolUse` → `pre_tool_use`, as Codex names events in the keys of trusts. */
function snakeCase(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
