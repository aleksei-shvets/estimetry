import { readdirSync } from 'node:fs';
import type { TaskStatusReader, TaskSummary } from '../../application/ports/task-status-reader.js';
import { exclusionsOf } from '../../domain/progress/plan-exclusions.js';
import { isInProgress } from '../../domain/task/task-status.js';
import { readYaml } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { parseTaskSnapshot } from './records.js';
import { ProjectId } from '../../domain/project/project-id.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import { TaskId } from '../../domain/task/task-id.js';

/**
 * Status of tasks from their snapshots, without checking the journal: a hook
 * cannot afford to read the journal on every call. A snapshot left behind by a
 * crash is rebuilt by the next CLI command; the hook is wrong for one call at most.
 */
export class FileTaskStatusReader implements TaskStatusReader {
  constructor(private readonly layout: StorageLayout) {}

  summary(task: TaskId): TaskSummary | undefined {
    return this.read(task.toString());
  }

  inProgress(project: ProjectId): TaskSummary[] {
    let names: string[];
    try {
      names = readdirSync(this.layout.tasksDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => /^T-\d+\.yaml$/.test(name))
      .map((name) => this.read(name.slice(0, -'.yaml'.length)))
      .filter((task): task is TaskSummary => task !== undefined && isInProgress(task.status))
      .filter((task) => task.projects.some((known) => known.equals(project)));
  }

  private read(task: string): TaskSummary | undefined {
    if (!/^T-\d+$/.test(task)) {
      return undefined;
    }
    let snapshot;
    try {
      snapshot = parseTaskSnapshot(readYaml(this.layout.taskSnapshot(task)));
    } catch {
      return undefined;
    }
    if (snapshot === undefined) {
      return undefined;
    }
    // The snapshot was checked as data; its ids and moments become value objects here, before they reach application.
    return {
      id: TaskId.parse(snapshot.id),
      title: snapshot.title,
      status: snapshot.status,
      projects: snapshot.projects.map((project) => ProjectId.parse(project)),
      ...groupsOf(snapshot.estimate?.parts),
      ...((snapshot.revisions ?? []).some((revision) => revision.spent === 'exclude')
        ? { exclusions: exclusionsOf(snapshot.revisions ?? []) }
        : {}),
      ...(snapshot.startedAt === undefined ? {} : { startedAt: Timestamp.parse(snapshot.startedAt) }),
    };
  }
}

function groupsOf(parts: readonly { readonly group?: string }[] | undefined): { groups?: string[] } {
  const groups = [...new Set((parts ?? []).flatMap((part) => (part.group === undefined ? [] : [part.group])))];
  return groups.length === 0 ? {} : { groups };
}
