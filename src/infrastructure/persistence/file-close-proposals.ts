import { randomBytes } from 'node:crypto';
import { renameSync, rmSync } from 'node:fs';
import type { CloseProposal, CloseProposals } from '../../application/ports/close-proposals.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';

const TASK_ID = /^T-\d+$/;

/**
 * `progress/<task>.proposal.yaml`. Taking renames the file to a name of its
 * own first: of hooks racing for it only one rename succeeds, so the proposal
 * is shown exactly once.
 */
export class FileCloseProposals implements CloseProposals {
  constructor(private readonly layout: StorageLayout) {}

  put(task: string, proposal: CloseProposal): void {
    if (TASK_ID.test(task)) {
      writeYamlAtomic(this.layout.closeProposal(task), { schemaVersion: 1, ...proposal });
    }
  }

  peek(task: string): CloseProposal | undefined {
    if (!TASK_ID.test(task)) {
      return undefined;
    }
    return this.parse(this.layout.closeProposal(task));
  }

  take(task: string): CloseProposal | undefined {
    if (!TASK_ID.test(task)) {
      return undefined;
    }
    const file = this.layout.closeProposal(task);
    const taken = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.taken`;
    try {
      renameSync(file, taken);
    } catch {
      return undefined; // none, or another hook took it first
    }
    try {
      return this.parse(taken);
    } finally {
      rmSync(taken, { force: true });
    }
  }

  remove(task: string): void {
    if (TASK_ID.test(task)) {
      rmSync(this.layout.closeProposal(task), { force: true });
    }
  }

  private parse(file: string): CloseProposal | undefined {
    let value: unknown;
    try {
      value = readYaml(file);
    } catch {
      return undefined;
    }
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const v = value as Record<string, unknown>;
    return typeof v['change'] === 'string' && typeof v['completedAt'] === 'string' && typeof v['session'] === 'string'
      ? {
          change: v['change'],
          ...(typeof v['project'] === 'string' ? { project: v['project'] } : {}),
          completedAt: v['completedAt'],
          session: v['session'],
        }
      : undefined;
  }
}
