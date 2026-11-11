import type { SessionLogFingerprint } from '../../application/ports/log-import-state.js';
import type { LogImportEntry, LogImportState } from '../../application/ports/log-import-state.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';

const SCHEMA_VERSION = 1;

export class YamlLogImportState implements LogImportState {
  constructor(private readonly layout: StorageLayout) {}

  locked<T>(session: string, work: () => T): T {
    return withFileLock(this.layout.logImportLock(session), work);
  }

  read(session: string): Readonly<Record<string, LogImportEntry>> {
    let value: unknown;
    try {
      value = readYaml(this.layout.logImport(session));
    } catch {
      return {}; // a broken cache: the log is read again from the start
    }
    const tasks = (value as { tasks?: unknown } | undefined)?.tasks;
    if (typeof tasks !== 'object' || tasks === null) {
      return {};
    }
    const entries: Record<string, LogImportEntry> = {};
    for (const [task, raw] of Object.entries(tasks as Record<string, unknown>)) {
      const entry = parseEntry(raw);
      if (entry !== undefined) {
        entries[task] = entry;
      }
    }
    return entries;
  }

  /** Called under `locked`; the other tasks of the session keep their entries. */
  write(session: string, task: string, entry: LogImportEntry): void {
    writeYamlAtomic(this.layout.logImport(session), { schemaVersion: SCHEMA_VERSION, tasks: { ...this.read(session), [task]: entry } });
  }
}

function parseEntry(raw: unknown): LogImportEntry | undefined {
  const entry = raw as { next?: unknown; fingerprint?: { main?: unknown; agents?: unknown } } | undefined;
  const main = file(entry?.fingerprint?.main);
  if (typeof entry?.next !== 'number' || !Number.isSafeInteger(entry.next) || entry.next < 0 || main === undefined) {
    return undefined;
  }
  const agents: Record<string, SessionLogFingerprint['main']> = {};
  const rawAgents = entry.fingerprint?.agents;
  if (typeof rawAgents === 'object' && rawAgents !== null) {
    for (const [agent, value] of Object.entries(rawAgents as Record<string, unknown>)) {
      const parsed = file(value);
      if (parsed !== undefined) {
        agents[agent] = parsed;
      }
    }
  }
  return { next: entry.next, fingerprint: { main, agents } };
}

function file(value: unknown): SessionLogFingerprint['main'] | undefined {
  const v = value as { size?: unknown; mtimeMs?: unknown } | undefined;
  return typeof v?.size === 'number' && typeof v.mtimeMs === 'number' ? { size: v.size, mtimeMs: v.mtimeMs } : undefined;
}
