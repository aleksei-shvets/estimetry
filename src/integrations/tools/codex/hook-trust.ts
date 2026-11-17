import { ourHandlers } from '../shared/hook-settings.js';

/**
 * Whether a hook of ours in a hooks file has no trust of Codex (codex-install spec, "Одобрение хуков Codex"). Codex
 * keeps trusts in the user config as `[hooks.state."<file>:<event in snake case>:<group>:<handler>"]` with
 * `trusted_hash` (checked on Codex 0.162.1). No config, or one with no trusts at all, is a user who has trusted
 * nothing yet. The format is internal to Codex, so the warning it gives says what it saw, not that Codex is off; a
 * hook changed after its trust looks trusted, since the hash is Codex's own. estimetry never writes a trust.
 */
export function untrustedHooks(config: string | undefined, hooksPath: string, hooksText: string | undefined, ours: string): boolean {
  return ourHandlers(hooksText, ours).some(
    (place) => !trusted(config ?? '', `${hooksPath}:${snakeCase(place.event)}:${place.group}:${place.handler}`),
  );
}

function trusted(config: string, key: string): boolean {
  const header = `[hooks.state."${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;
  const start = config.indexOf(header);
  if (start < 0) {
    return false;
  }
  const body = config.slice(start + header.length);
  const section = body.slice(0, body.search(/^\s*\[/m) < 0 ? body.length : body.search(/^\s*\[/m));
  return /^\s*trusted_hash\s*=/m.test(section);
}

/** `PreToolUse` → `pre_tool_use`, as Codex names events in the keys of trusts. */
function snakeCase(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
