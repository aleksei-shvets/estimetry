import type { SessionLogRead, SessionLogReader, SessionLogRequest, SessionLogResult } from '../../src/application/contracts/session-logs.js';
import type { SessionLogFingerprint } from '../../src/application/ports/log-import-state.js';
import type { LogImportEntry, LogImportState } from '../../src/application/ports/log-import-state.js';
import { SessionLogReaderRegistry } from '../../src/integrations/tools/session-log-readers.js';
import type { CalibrationStore } from '../../src/application/ports/calibration-store.js';
import type { CardStore, StoredCard } from '../../src/application/ports/card-store.js';
import type { CloseProposal, CloseProposals } from '../../src/application/ports/close-proposals.js';
import type { AuthorCommit, CodeMeasurer } from '../../src/application/ports/code-measurer.js';
import type { GitHead } from '../../src/application/ports/git-snapshot.js';
import type { Calibration } from '../../src/domain/calibration/calibration.js';
import type { Card } from '../../src/domain/card/card.js';
import type { FileLines } from '../../src/domain/progress/progress-records.js';
import { RecordingErrorReporter } from './fakes.js';
import { SessionId } from '../../src/domain/measurement/session-id.js';
import { ProjectId } from '../../src/domain/project/project-id.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import type { TaskId } from '../../src/domain/task/task-id.js';

export class InMemoryCardStore implements CardStore {
  readonly cards = new Map<string, Card>();
  /** Cards of other schemas, as an older or a newer estimetry left them. */
  readonly others = new Map<string, StoredCard>();
  failWrite = false;

  write(card: Card): void {
    if (this.failWrite) {
      throw new Error('disk full');
    }
    this.others.delete(card.task.id);
    this.cards.set(card.task.id, card);
  }

  read(task: TaskId): StoredCard | undefined {
    const card = this.cards.get(task.toString());
    return card === undefined ? this.others.get(task.toString()) : { schema: 'current', card };
  }

  remove(task: TaskId): void {
    this.cards.delete(task.toString());
    this.others.delete(task.toString());
  }

  list(): StoredCard[] {
    return [...this.cards.values()].map((card): StoredCard => ({ schema: 'current', card })).concat([...this.others.values()]);
  }
}

export class InMemoryCalibrationStore implements CalibrationStore {
  current: Calibration | undefined;
  fail = false;

  recalculate(compute: () => Calibration): Calibration {
    if (this.fail) {
      throw new Error('calibration.json is read-only');
    }
    this.current = compute();
    return this.current;
  }

  read(): Calibration | undefined {
    return this.current;
  }
}

export class InMemoryCloseProposals implements CloseProposals {
  readonly pending = new Map<string, CloseProposal>();

  put(task: TaskId, proposal: CloseProposal): void {
    this.pending.set(task.toString(), proposal);
  }

  peek(task: TaskId): CloseProposal | undefined {
    return this.pending.get(task.toString());
  }

  take(task: TaskId): CloseProposal | undefined {
    const proposal = this.pending.get(task.toString());
    this.pending.delete(task.toString());
    return proposal;
  }

  remove(task: TaskId): void {
    this.pending.delete(task.toString());
  }

  /** The pending proposal of a task in plain values, for assertions. */
  plain(task: string): { change: string; project?: string; completedAt: string; session: string } | undefined {
    const proposal = this.pending.get(task);
    return proposal === undefined
      ? undefined
      : {
          change: proposal.change,
          ...(proposal.project === undefined ? {} : { project: proposal.project.value }),
          completedAt: proposal.completedAt.toISOString(),
          session: proposal.session.value,
        };
  }

  /** A proposal from plain values, as a test writes it. */
  putPlain(task: string, proposal: { change: string; project?: string; completedAt: string; session: string }): void {
    this.pending.set(task, {
      change: proposal.change,
      ...(proposal.project === undefined ? {} : { project: ProjectId.parse(proposal.project) }),
      completedAt: Timestamp.parse(proposal.completedAt),
      session: SessionId.parse(proposal.session),
    });
  }
}

/** Git of one or more working copies, by root. */
export class FakeCodeMeasurer implements CodeMeasurer, GitHead {
  heads = new Map<string, string>();
  pending = new Map<string, FileLines[]>();
  /** Shas reachable from `HEAD`; an unknown root cannot tell. */
  reachableShas = new Map<string, Set<string>>();
  authored = new Map<string, AuthorCommit[]>();

  uncommitted(root: string): FileLines[] | undefined {
    return this.heads.has(root) ? (this.pending.get(root) ?? []) : undefined;
  }

  head(root: string): string | undefined {
    return this.heads.get(root);
  }

  reachable(root: string, sha: string): boolean | undefined {
    const known = this.reachableShas.get(root);
    return known === undefined ? undefined : known.has(sha);
  }

  authorCommits(root: string): AuthorCommit[] | undefined {
    return this.heads.has(root) ? (this.authored.get(root) ?? []) : undefined;
  }
}

/** A session log reader over logs set by the test: each a full read result, cut at the requested offset. */
export class FakeSessionLogs implements SessionLogReader {
  readonly id = 'claude-code';
  readonly logs = new Map<string, SessionLogRead>();
  /** Results other than a read, by session: not found, no data, over budget. */
  readonly statuses = new Map<string, SessionLogResult>();
  readonly requests: SessionLogRequest[] = [];

  fingerprint(session: SessionId): SessionLogFingerprint | undefined {
    const status = this.statuses.get(session.value);
    if (status !== undefined) {
      return status.status === 'not-found' ? undefined : 'fingerprint' in status ? status.fingerprint : { main: { size: 1, mtimeMs: 1 }, agents: {} };
    }
    return this.logs.get(session.value)?.fingerprint;
  }

  read(request: SessionLogRequest): SessionLogResult {
    this.requests.push(request);
    const status = this.statuses.get(request.session.value);
    if (status !== undefined) {
      return status;
    }
    const log = this.logs.get(request.session.value);
    if (log === undefined) {
      return { status: 'not-found' };
    }
    return { ...log, from: request.from, turns: log.turns.filter((turn) => turn.key >= request.from) };
  }
}

export class InMemoryLogImportState implements LogImportState {
  readonly entries = new Map<string, Record<string, LogImportEntry>>();
  locked<T>(_session: SessionId, work: () => T): T {
    return work();
  }
  read(session: SessionId): Readonly<Record<string, LogImportEntry>> {
    return { ...(this.entries.get(session.value) ?? {}) };
  }
  write(session: SessionId, task: TaskId, entry: LogImportEntry): void {
    this.entries.set(session.value, { ...(this.entries.get(session.value) ?? {}), [task.toString()]: entry });
  }
}

export function fakeClosing(overrides: Partial<ReturnType<typeof defaults>> = {}) {
  return { ...defaults(), ...overrides };
}

function defaults() {
  const git = new FakeCodeMeasurer();
  return {
    cards: new InMemoryCardStore(),
    calibration: new InMemoryCalibrationStore(),
    settings: { minTasks: () => 5, authorAliases: (): readonly string[] => [] },
    proposals: new InMemoryCloseProposals(),
    code: git,
    head: git,
    errors: new RecordingErrorReporter(),
    logs: { readers: new SessionLogReaderRegistry().register(new FakeSessionLogs()), state: new InMemoryLogImportState() },
  };
}

/** The ports of the closing as `EstimetryDependencies` takes them, side by side. */
export function closingPorts(closing: ReturnType<typeof fakeClosing>) {
  return {
    cards: closing.cards,
    calibration: closing.calibration,
    calibrationSettings: closing.settings,
    proposals: closing.proposals,
    codeMeasurer: closing.code,
    gitHead: closing.head,
    errors: closing.errors,
    logReaders: closing.logs.readers,
    logImportState: closing.logs.state,
  };
}
