import { readdirSync } from 'node:fs';
import type { CheckpointState, CheckpointStatus } from '../../application/ports/checkpoint-state.js';
import { carryOver, type SessionBinding, type SessionBindings } from '../../application/ports/session-bindings.js';
import { SessionId } from '../../domain/measurement/session-id.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import { withFileLock } from '../fs/file-lock.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { ProjectId } from '../../domain/project/project-id.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import { TaskId } from '../../domain/task/task-id.js';

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
      const changed = change(current);
      if (changed === undefined) {
        return current;
      }
      const next = carryOver(current, changed);
      writeYamlAtomic(this.layout.sessionBinding(session.value), { schemaVersion: SESSION_SCHEMA_VERSION, ...bindingData(next) });
      return next;
    });
  }

  ofProject(project: ProjectId): SessionBinding[] {
    let names: string[];
    try {
      names = readdirSync(this.layout.sessionsDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith('.yaml') && !name.endsWith('.checkpoint.yaml'))
      .map((name) => parseBinding(safeRead(`${this.layout.sessionsDir}/${name}`)))
      .filter((binding): binding is SessionBinding => binding !== undefined && binding.project.equals(project));
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

/** The binding as the file keeps it: ids and moments as strings, in the order of its fields. */
function bindingData(binding: SessionBinding): Record<string, unknown> {
  const plain = (value: unknown): unknown =>
    value instanceof Timestamp ? value.toISOString() : Array.isArray(value) ? value.map(plain) : isId(value) ? value.toString() : value;
  return Object.fromEntries(Object.entries(binding).map(([key, value]) => [key, plain(value)]));
}

function isId(value: unknown): value is TaskId | ProjectId | SessionId {
  return value instanceof TaskId || value instanceof ProjectId || value instanceof SessionId;
}

/** A binding with an id or a moment that does not parse counts as missing, as a broken file does. */
function parseBinding(value: unknown): SessionBinding | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  if (typeof v['session'] !== 'string' || typeof v['project'] !== 'string' || typeof v['root'] !== 'string') {
    return undefined;
  }
  const text = (key: string) => (typeof v[key] === 'string' ? (v[key] as string) : undefined);
  const optional = <T>(key: string, parse: (text: string) => T) => {
    const found = text(key);
    return found === undefined ? {} : { [key]: parse(found) };
  };
  try {
    return {
      session: SessionId.parse(v['session']),
      project: ProjectId.parse(v['project']),
      root: v['root'],
      ...optional('task', TaskId.parse),
      ...optional('since', Timestamp.parse),
      ...optional('checkedAt', Timestamp.parse),
      ...optional('closedTask', TaskId.parse),
      ...optional('transcript', (path) => path),
      ...(Array.isArray(v['tasks']) && v['tasks'].every((task) => typeof task === 'string')
        ? { tasks: (v['tasks'] as string[]).map((task) => TaskId.parse(task)) }
        : {}),
      ...(v['everBound'] === true ? { everBound: true } : {}),
    };
  } catch {
    return undefined;
  }
}
