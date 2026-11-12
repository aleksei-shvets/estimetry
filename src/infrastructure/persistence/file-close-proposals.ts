import { randomBytes } from 'node:crypto';
import { renameSync, rmSync } from 'node:fs';
import type { CloseProposal, CloseProposals } from '../../application/ports/close-proposals.js';
import { readYaml, writeYamlAtomic } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { SessionId } from '../../domain/measurement/session-id.js';
import { ProjectId } from '../../domain/project/project-id.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import type { TaskId } from '../../domain/task/task-id.js';

/**
 * `progress/<task>.proposal.yaml`. Taking renames the file to a name of its
 * own first: of hooks racing for it only one rename succeeds, so the proposal
 * is shown exactly once.
 */
export class FileCloseProposals implements CloseProposals {
  constructor(private readonly layout: StorageLayout) {}

  put(task: TaskId, proposal: CloseProposal): void {
    writeYamlAtomic(this.layout.closeProposal(task.toString()), {
      schemaVersion: 1,
      change: proposal.change,
      ...(proposal.project === undefined ? {} : { project: proposal.project.value }),
      completedAt: proposal.completedAt.toISOString(),
      session: proposal.session.value,
    });
  }

  peek(task: TaskId): CloseProposal | undefined {
    return this.parse(this.layout.closeProposal(task.toString()));
  }

  take(task: TaskId): CloseProposal | undefined {
    const file = this.layout.closeProposal(task.toString());
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

  remove(task: TaskId): void {
    rmSync(this.layout.closeProposal(task.toString()), { force: true });
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
    if (typeof v['change'] !== 'string' || typeof v['completedAt'] !== 'string' || typeof v['session'] !== 'string') {
      return undefined;
    }
    try {
      return {
        change: v['change'],
        ...(typeof v['project'] === 'string' ? { project: ProjectId.parse(v['project']) } : {}),
        completedAt: Timestamp.parse(v['completedAt']),
        session: SessionId.parse(v['session']),
      };
    } catch {
      return undefined; // a proposal that does not parse is no proposal
    }
  }
}
