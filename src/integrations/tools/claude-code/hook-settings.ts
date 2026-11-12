import { isEstimetryCommand } from '../../../application/contracts/estimetry-command.js';
import { InstallBlocked } from '../../../application/contracts/install-blocked.js';

/**
 * Our hooks are recognised by this prefix, or by the command of this installation
 * (`estimetryCommand`) that falls back to it; a hook the user rewrote is theirs.
 */
const HOOK_ARGS = 'hook claude-code';
export const HOOK_PREFIX = `estimetry ${HOOK_ARGS}`;
export const HOOK_TIMEOUT_SECONDS = 10;

/** The hooks to install: one per event, the synchronous ones without `async`, each with its command. */
export interface HookSet {
  readonly events: readonly string[];
  readonly synchronous: readonly string[];
  readonly command: (event: string) => string;
}

type Json = Record<string, unknown>;

/** Result of a change to a settings file: new text, or `undefined` to delete a file left empty. */
export type SettingsText = string | undefined;

/**
 * Adds one hook per event and drops our earlier ones; every other key, hook and
 * their order stay. `displayPath` names the file in the error a broken one gives.
 */
export function withHooks(text: string | undefined, set: HookSet, displayPath: string): string {
  const { events, synchronous } = set;
  const settings = parse(text, displayPath) ?? {};
  const hooks = withoutOurHooks(hooksOf(settings, displayPath));
  for (const event of events) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    // The agent does not wait for an async hook: only hooks whose context it needs now, or the session end, are synchronous.
    const handler = {
      type: 'command',
      command: set.command(event),
      timeout: HOOK_TIMEOUT_SECONDS,
      ...(synchronous.includes(event) ? {} : { async: true }),
    };
    hooks[event] = [...groups, { hooks: [handler] }];
  }
  return render({ ...settings, hooks }, text);
}

/** Drops our hooks from a file we no longer install into; `undefined` when nothing else is left. */
export function withoutHooks(text: string, displayPath: string): SettingsText {
  const settings = parse(text, displayPath);
  if (settings === undefined || !isObject(settings['hooks'])) {
    return text;
  }
  const hooks = withoutOurHooks(settings['hooks']);
  const { hooks: _old, ...rest } = settings;
  const next = Object.keys(hooks).length > 0 ? { ...settings, hooks } : rest;
  if (Object.keys(next).length === 0) {
    return undefined;
  }
  return render(next, text);
}

/** A settings file that is there but does not parse. */
export function isBrokenJson(text: string | undefined): boolean {
  if (text === undefined) {
    return false;
  }
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

export function hasOurHooks(text: string | undefined): boolean {
  try {
    const settings = text === undefined ? undefined : (JSON.parse(text) as unknown);
    return isObject(settings) && isObject(settings['hooks']) && Object.values(settings['hooks']).some((groups) => groupsHaveOurs(groups));
  } catch {
    return false;
  }
}

function withoutOurHooks(hooks: Json): Json {
  const result: Json = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      result[event] = groups;
      continue;
    }
    const kept = groups.flatMap((group: unknown) => {
      if (!isObject(group) || !Array.isArray(group['hooks'])) {
        return [group];
      }
      const handlers = group['hooks'].filter((handler: unknown) => !isOurs(handler));
      if (handlers.length === group['hooks'].length) {
        return [group];
      }
      return handlers.length === 0 ? [] : [{ ...group, hooks: handlers }];
    });
    if (kept.length > 0) {
      result[event] = kept;
    }
  }
  return result;
}

function groupsHaveOurs(groups: unknown): boolean {
  return Array.isArray(groups) && groups.some((group) => isObject(group) && Array.isArray(group['hooks']) && group['hooks'].some(isOurs));
}

function isOurs(handler: unknown): boolean {
  return (
    isObject(handler) &&
    handler['type'] === 'command' &&
    typeof handler['command'] === 'string' &&
    isOurCommand(handler['command'])
  );
}

function isOurCommand(command: string): boolean {
  return isEstimetryCommand(command, HOOK_ARGS);
}

function hooksOf(settings: Json, displayPath: string): Json {
  const hooks = settings['hooks'];
  if (hooks === undefined) {
    return {};
  }
  if (!isObject(hooks)) {
    throw new InstallBlocked(`${displayPath}: "hooks" must be an object; fix the file or remove the key, then run init again`);
  }
  return hooks;
}

function parse(text: string | undefined, displayPath: string): Json | undefined {
  if (text === undefined || text.trim() === '') {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InstallBlocked(`${displayPath}: not valid JSON; fix the file, then run init again`);
  }
  if (!isObject(value)) {
    throw new InstallBlocked(`${displayPath}: expected a JSON object`);
  }
  return value;
}

/** Keeps the indentation the file already uses; two spaces for a new one. */
function render(settings: Json, previous: string | undefined): string {
  const indent = /^([ \t]+)\S/m.exec(previous ?? '')?.[1] ?? '  ';
  return `${JSON.stringify(settings, null, indent)}\n`;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
