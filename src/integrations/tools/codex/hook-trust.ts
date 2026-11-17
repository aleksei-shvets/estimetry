import { ourHandlers } from '../shared/hook-settings.js';

/**
 * Whether Codex has a trust of our hooks in a hooks file (codex-install spec, "Одобрение хуков Codex"). Codex keeps
 * trusts in the user config as `[hooks.state."<file>:<event in snake case>:<group>:<handler>"]` with
 * `trusted_hash`. The format is internal to Codex, so this is a narrow reading of those table headers: `undefined`
 * when the config holds no `[hooks.state` at all, and a hook changed after its trust looks trusted (its hash is
 * Codex's own). estimetry never writes a trust.
 */
export function untrustedHooks(
  config: string | undefined,
  hooksPath: string,
  hooksText: string | undefined,
  ours: string,
): boolean | undefined {
  if (config === undefined || !config.includes('[hooks.state')) {
    return undefined;
  }
  return ourHandlers(hooksText, ours).some(
    (place) => !trusted(config, `${hooksPath}:${snakeCase(place.event)}:${place.group}:${place.handler}`),
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
