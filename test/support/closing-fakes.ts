import type { SessionLogFingerprint, SessionLogRead, SessionLogReader, SessionLogRequest, SessionLogResult } from '../../src/application/contracts/session-logs.js';
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

  read(task: string): StoredCard | undefined {
    const card = this.cards.get(task);
    return card === undefined ? this.others.get(task) : { schema: 'current', card };
  }

  remove(task: string): void {
    this.cards.delete(task);
    this.others.delete(task);
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

  put(task: string, proposal: CloseProposal): void {
    this.pending.set(task, proposal);
  }

  peek(task: string): CloseProposal | undefined {
    return this.pending.get(task);
  }

  take(task: string): CloseProposal | undefined {
    const proposal = this.pending.get(task);
    this.pending.delete(task);
    return proposal;
  }

  remove(task: string): void {
    this.pending.delete(task);
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

  fingerprint(session: string): SessionLogFingerprint | undefined {
    const status = this.statuses.get(session);
    if (status !== undefined) {
      return status.status === 'not-found' ? undefined : 'fingerprint' in status ? status.fingerprint : { main: { size: 1, mtimeMs: 1 }, agents: {} };
    }
    return this.logs.get(session)?.fingerprint;
  }

  read(request: SessionLogRequest): SessionLogResult {
    this.requests.push(request);
    const status = this.statuses.get(request.session);
    if (status !== undefined) {
      return status;
    }
    const log = this.logs.get(request.session);
    if (log === undefined) {
      return { status: 'not-found' };
    }
    return { ...log, from: request.from, turns: log.turns.filter((turn) => turn.key >= request.from) };
  }
}

export class InMemoryLogImportState implements LogImportState {
  readonly entries = new Map<string, Record<string, LogImportEntry>>();
  locked<T>(_session: string, work: () => T): T {
    return work();
  }
  read(session: string): Readonly<Record<string, LogImportEntry>> {
    return { ...(this.entries.get(session) ?? {}) };
  }
  write(session: string, task: string, entry: LogImportEntry): void {
    this.entries.set(session, { ...(this.entries.get(session) ?? {}), [task]: entry });
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
