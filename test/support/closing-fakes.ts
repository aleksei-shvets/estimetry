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
  };
}
