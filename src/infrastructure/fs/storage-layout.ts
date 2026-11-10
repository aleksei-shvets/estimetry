import { join } from 'node:path';

export interface StorageEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

/**
 * Where estimetry keeps its data (design §9). Nothing is created here:
 * writers create the directories they need, so read-only commands leave no trace.
 */
export class StorageLayout {
  constructor(readonly root: string) {}

  /** `ESTIMETRY_HOME`, then `$XDG_DATA_HOME/estimetry`, then `~/.local/share/estimetry`. */
  static resolve({ env, homeDir }: StorageEnvironment): StorageLayout {
    const explicit = env['ESTIMETRY_HOME']?.trim();
    if (explicit) {
      return new StorageLayout(explicit);
    }
    const xdg = env['XDG_DATA_HOME']?.trim();
    return new StorageLayout(join(xdg ? xdg : join(homeDir, '.local', 'share'), 'estimetry'));
  }

  get configFile(): string {
    return join(this.root, 'config.yaml');
  }

  get projectsFile(): string {
    return join(this.root, 'projects.yaml');
  }

  get tasksDir(): string {
    return join(this.root, 'tasks');
  }

  get eventsDir(): string {
    return join(this.root, 'events');
  }

  get errorsLog(): string {
    return join(this.root, 'errors.log');
  }

  taskSnapshot(taskId: string): string {
    return join(this.tasksDir, `${taskId}.yaml`);
  }

  taskJournal(taskId: string): string {
    return join(this.eventsDir, `${taskId}.jsonl`);
  }

  taskLock(taskId: string): string {
    return join(this.tasksDir, `${taskId}.lock`);
  }

  get taskIdLock(): string {
    return join(this.tasksDir, '.id.lock');
  }

  get projectsLock(): string {
    return join(this.root, 'projects.lock');
  }

  get configLock(): string {
    return join(this.root, 'config.lock');
  }

  get sessionsDir(): string {
    return join(this.root, 'sessions');
  }

  /** The session ids are checked by SessionId before they get here. */
  sessionBinding(session: string): string {
    return join(this.sessionsDir, `${session}.yaml`);
  }

  sessionLock(session: string): string {
    return join(this.sessionsDir, `${session}.lock`);
  }

  sessionCheckpoints(session: string): string {
    return join(this.sessionsDir, `${session}.checkpoint.yaml`);
  }

  get cardsDir(): string {
    return join(this.root, 'cards');
  }

  /** The task id is checked before it gets here. */
  card(taskId: string): string {
    return join(this.cardsDir, `${taskId}.yaml`);
  }

  get calibrationFile(): string {
    return join(this.root, 'calibration.json');
  }

  get calibrationLock(): string {
    return join(this.root, 'calibration.lock');
  }

  /** The pending proposal to close a task; the task id is checked before it gets here. */
  closeProposal(taskId: string): string {
    return join(this.root, 'progress', `${taskId}.proposal.yaml`);
  }

  /** Cache of archive directories already looked at for a task; the task id is checked before it gets here. */
  taskProgress(taskId: string): string {
    return join(this.root, 'progress', `${taskId}.yaml`);
  }

  /** Cache of the imports of a session's log, by task; the session id is checked before it gets here. */
  logImport(session: string): string {
    return join(this.root, 'log-import', `${session}.yaml`);
  }

  logImportLock(session: string): string {
    return join(this.root, 'log-import', `${session}.lock`);
  }

  unassignedJournal(project: string): string {
    return join(this.eventsDir, 'unassigned', `${project}.jsonl`);
  }
}
