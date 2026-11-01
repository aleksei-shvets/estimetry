import { readdirSync } from 'node:fs';
import type { CheckpointState, CheckpointStatus } from '../../application/ports/checkpoint-state.js';
import type { SessionBinding, SessionBindings } from '../../application/ports/session-bindings.js';
import type { SessionId } from '../../domain/measurement/session-id.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';

export const SESSION_SCHEMA_VERSION = 1;

/**
 * `sessions/<session>.yaml`: which task a session serves. Changes go under the
 * lock of the session, so a hook writing a checkpoint can never undo an `attach`.
 */
export class YamlSessionStore implements SessionBindings {
  constructor(private readonly layout: StorageLayout) {}

  get(session: SessionId): SessionBinding | undefined {
    return parseBinding(safeRead(this.layout.sessionBinding(session.value)));
  }

  update(session: SessionId, change: (current: SessionBinding | undefined) => SessionBinding | undefined): SessionBinding | undefined {
    return withFileLock(this.layout.sessionLock(session.value), () => {
      const current = this.get(session);
      const next = change(current);
      if (next === undefined) {
        return current;
      }
      writeYamlAtomic(this.layout.sessionBinding(session.value), { schemaVersion: SESSION_SCHEMA_VERSION, ...next });
      return next;
    });
  }

  ofProject(project: string): SessionBinding[] {
    let names: string[];
    try {
      names = readdirSync(this.layout.sessionsDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith('.yaml') && !name.endsWith('.checkpoint.yaml'))
      .map((name) => parseBinding(safeRead(`${this.layout.sessionsDir}/${name}`)))
      .filter((binding): binding is SessionBinding => binding?.project === project);
  }
}

/** `sessions/<session>.checkpoint.yaml`, written without a lock: two checkpoints in a row are harmless. */
export class YamlCheckpointState implements CheckpointState {
  constructor(private readonly layout: StorageLayout) {}

  read(session: SessionId): CheckpointStatus {
    const value = safeRead(this.layout.sessionCheckpoints(session.value));
    if (typeof value !== 'object' || value === null) {
      return {};
    }
    const v = value as Record<string, unknown>;
    return {
      ...(typeof v['lastAt'] === 'string' ? { lastAt: v['lastAt'] } : {}),
      ...(v['reminderPending'] === true ? { reminderPending: true } : {}),
      ...(v['configReported'] === true ? { configReported: true } : {}),
      ...(typeof v['lastSeenAt'] === 'string' ? { lastSeenAt: v['lastSeenAt'] } : {}),
    };
  }

  write(session: SessionId, status: CheckpointStatus): void {
    writeYamlAtomic(this.layout.sessionCheckpoints(session.value), { schemaVersion: SESSION_SCHEMA_VERSION, ...status });
  }
}

/** A broken file counts as missing: the session is looked up again. */
function safeRead(file: string): unknown {
  try {
    return readYaml(file);
  } catch {
    return undefined;
  }
}

function parseBinding(value: unknown): SessionBinding | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  if (typeof v['session'] !== 'string' || typeof v['project'] !== 'string' || typeof v['root'] !== 'string') {
    return undefined;
  }
  const optional = (key: string) => (typeof v[key] === 'string' ? { [key]: v[key] as string } : {});
  return {
    session: v['session'],
    project: v['project'],
    root: v['root'],
    ...optional('task'),
    ...optional('since'),
    ...optional('checkedAt'),
    ...(v['everBound'] === true ? { everBound: true } : {}),
  };
}
