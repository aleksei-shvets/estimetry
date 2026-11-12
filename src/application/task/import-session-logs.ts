import type { LogAgent, LogSession, LogTurn } from '../../domain/progress/session-log.js';
import type { SessionId } from '../../domain/measurement/session-id.js';
import type { ProjectId } from '../../domain/project/project-id.js';
import type { TaskId } from '../../domain/task/task-id.js';
import type { Timestamp } from '../../domain/shared/timestamp.js';
import { SessionLogFailure, type SessionLogReaders } from '../contracts/session-logs.js';
import type { FileFingerprint, SessionLogFingerprint } from '../ports/log-import-state.js';
import type { EventMetaSource } from '../shared/event-meta-source.js';
import { journalEntry } from '../shared/journal-entry.js';
import type { ErrorReporter } from '../ports/error-reporter.js';
import type { EventJournal } from '../ports/event-journal.js';
import type { LogImportState } from '../ports/log-import-state.js';

/** A record of a session log is split into parts no larger than this. */
export const MAX_RECORD_BYTES = 64 * 1024;

export type LogImportOutcome = 'imported' | 'no-new-data' | 'not-found' | 'no-data' | 'unrecognized' | 'over-budget' | 'failed';

export interface SessionImport {
  readonly session: SessionId;
  readonly task: TaskId;
  readonly outcome: LogImportOutcome;
}

/** A task the log goes into, with its home project for the envelope. */
export interface ImportTask {
  readonly id: TaskId;
  readonly project: ProjectId;
}

export interface SessionImportRequest {
  readonly session: SessionId;
  /** Tool id of the session's activity events; it picks the log reader. */
  readonly source: string;
  /** The path the tool reported in its hooks, if known. */
  readonly path?: string;
  /** Tasks in progress the session served, each with its home project for the envelope. */
  readonly tasks: readonly ImportTask[];
  readonly budgetMs?: number;
  /** The moment the records carry; the clock's now when absent. The closing stamps them with its own time. */
  readonly at?: Timestamp;
}

export interface ImportDependencies {
  readonly readers: SessionLogReaders;
  readonly state: LogImportState;
  readonly journal: Pick<EventJournal, 'appendRecord'>;
  /** Ids, the author and the clock's now of the records. */
  readonly meta: EventMetaSource;
  readonly errors: ErrorReporter;
}

/**
 * Imports the log of a session into the journals of its tasks (session-log-import
 * spec): under the lock of the session, only when the files changed, reading
 * the file once from the earliest offset the tasks need, each task getting
 * what is new since its own last import.
 */
export class ImportSessionLogs {
  constructor(private readonly deps: ImportDependencies) {}

  execute(request: SessionImportRequest): SessionImport[] {
    const reader = this.deps.readers.get(request.source);
    const results = (outcome: LogImportOutcome, tasks = request.tasks) =>
      tasks.map((task) => ({ session: request.session, task: task.id, outcome }));
    if (reader === undefined || request.tasks.length === 0) {
      return results('not-found');
    }
    try {
      return this.deps.state.locked(request.session, () => {
        const known = this.deps.state.read(request.session);
        const fingerprint = reader.fingerprint(request.session, request.path);
        if (fingerprint === undefined) {
          return results('not-found');
        }
        const due = request.tasks.filter((task) => !same(known[task.id.toString()]?.fingerprint, fingerprint));
        const fresh = request.tasks
          .filter((task) => !due.includes(task))
          .map((task) => ({ session: request.session, task: task.id, outcome: 'no-new-data' as const }));
        if (due.length === 0) {
          return fresh;
        }
        const from = Math.min(...due.map((task) => known[task.id.toString()]?.next ?? 0));
        const read = reader.read({
          session: request.session,
          ...(request.path === undefined ? {} : { path: request.path }),
          from,
          ...(request.budgetMs === undefined ? {} : { budgetMs: request.budgetMs }),
        });
        if (read.status === 'over-budget' || read.status === 'unrecognized') {
          this.deps.errors.report(
            `importing the log of session ${request.session.value}`,
            new SessionLogFailure(read.status === 'over-budget' ? 'log-import-budget' : 'log-format-unrecognized'),
          );
        }
        if (read.status === 'no-data') {
          for (const task of due) {
            this.deps.state.write(request.session, task.id, { fingerprint: read.fingerprint, next: 0 });
          }
        }
        if (read.status !== 'read') {
          return [...fresh, ...results(read.status, due)];
        }
        for (const task of due) {
          const entry = known[task.id.toString()];
          // A file that shrank is read from the start: then every task starts there too.
          const offset = read.from < from ? read.from : (entry?.next ?? 0);
          const turns: LogTurn[] = read.turns.filter((turn) => turn.key >= offset).map((turn) => ({ ...turn, tokens: [...turn.tokens] }));
          const agents: LogAgent[] = read.agents
            .filter((agent) => !sameFile(entry?.fingerprint.agents[agent.agent], read.fingerprint.agents[agent.agent]) || read.from < from)
            .map((agent) => ({ agent: agent.agent, spans: agent.spans.map(([a, b]) => [a, b] as const), tokens: [...agent.tokens] }));
          this.write(task, request.session, `${request.source}-log`, request.at ?? this.deps.meta.now(), {
            from: offset,
            turns,
            agents,
            cost: read.cost,
            skipped: read.skipped,
          });
          this.deps.state.write(request.session, task.id, { fingerprint: read.fingerprint, next: read.next });
        }
        return [...fresh, ...results('imported', due)];
      });
    } catch (error) {
      // Only a code and the session reach the error log: never a line or a path of the log.
      this.deps.errors.report(
        `importing the log of session ${request.session.value}`,
        error instanceof SessionLogFailure ? error : new SessionLogFailure('log-import-failed'),
      );
      return results('failed');
    }
  }

  /**
   * Writes one import as records of at most MAX_RECORD_BYTES; parts share the
   * import id. A turn or subagent too large for one record goes in pieces that
   * the reading joins again (`sessionLogs`).
   */
  private write(
    task: ImportTask,
    session: SessionId,
    source: string,
    at: Timestamp,
    content: { from: number; turns: LogTurn[]; agents: LogAgent[]; cost: LogSession['data']['cost']; skipped: number },
  ): void {
    const items: ({ turn: LogTurn } | { agent: LogAgent })[] = [
      ...content.turns.flatMap((turn) => pieces(turn.tokens, [], (tokens) => ({ turn: { ...turn, tokens } }))),
      ...content.agents.flatMap((agent) => pieces(agent.tokens, agent.spans, (tokens, spans) => ({ agent: { ...agent, tokens, spans } }))),
    ];
    const parts: { turns: LogTurn[]; agents: LogAgent[] }[] = [{ turns: [], agents: [] }];
    let size = JSON.stringify(content.cost).length;
    for (const item of items) {
      const length = JSON.stringify(item).length;
      const current = parts[parts.length - 1] as { turns: LogTurn[]; agents: LogAgent[] };
      const empty = current.turns.length === 0 && current.agents.length === 0;
      if (!empty && size + length > RECORD_BUDGET) {
        parts.push({ turns: [], agents: [] });
        size = 0;
      }
      const target = parts[parts.length - 1] as { turns: LogTurn[]; agents: LogAgent[] };
      if ('turn' in item) {
        target.turns.push(item.turn);
      } else {
        target.agents.push(item.agent);
      }
      size += length;
    }
    const importId = this.deps.meta.id();
    parts.forEach((part, i) => {
      const data: LogSession['data'] = {
        source,
        session: session.value,
        importId,
        from: content.from,
        part: i + 1,
        parts: parts.length,
        turns: part.turns,
        agents: part.agents,
        cost: i === 0 ? content.cost : [],
        skipped: i === 0 ? content.skipped : 0,
      };
      this.deps.journal.appendRecord(
        journalEntry<LogSession>('log.session', data, { ...this.deps.meta.at(at), project: task.project, task: task.id }),
      );
    });
  }
}

/** Room for the payload of one record: the envelope and the other fields take the rest. */
const RECORD_BUDGET = MAX_RECORD_BYTES - 2048;
/** Token buckets or spans in one piece: about 150 bytes each, well under the budget. */
const PIECE = 300;

/** Splits the lists of a turn or subagent into pieces small enough for a record; the first piece keeps the times. */
function pieces<T, S, R>(tokens: readonly T[], spans: readonly S[], make: (tokens: T[], spans: S[]) => R): R[] {
  const count = Math.max(1, Math.ceil(tokens.length / PIECE), Math.ceil(spans.length / PIECE));
  return Array.from({ length: count }, (_, i) => make(tokens.slice(i * PIECE, (i + 1) * PIECE), spans.slice(i * PIECE, (i + 1) * PIECE)));
}

function same(known: SessionLogFingerprint | undefined, now: SessionLogFingerprint): boolean {
  if (known === undefined || !sameFile(known.main, now.main)) {
    return false;
  }
  const agents = new Set([...Object.keys(known.agents), ...Object.keys(now.agents)]);
  return [...agents].every((agent) => sameFile(known.agents[agent], now.agents[agent]));
}

function sameFile(a: FileFingerprint | undefined, b: FileFingerprint | undefined): boolean {
  return a !== undefined && b !== undefined && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
