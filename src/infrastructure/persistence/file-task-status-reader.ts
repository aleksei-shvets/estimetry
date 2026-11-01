import { readdirSync } from 'node:fs';
import type { TaskStatusReader, TaskSummary } from '../../application/ports/task-status-reader.js';
import { readYaml } from '../fs/atomic-yaml.js';
import type { StorageLayout } from '../fs/storage-layout.js';
import { parseTaskSnapshot } from './records.js';

/**
 * Status of tasks from their snapshots, without checking the journal: a hook
 * cannot afford to read the journal on every call. A snapshot left behind by a
 * crash is rebuilt by the next CLI command; the hook is wrong for one call at most.
 */
export class FileTaskStatusReader implements TaskStatusReader {
  constructor(private readonly layout: StorageLayout) {}

  summary(task: string): TaskSummary | undefined {
    return this.read(task);
  }

  inProgress(project: string): TaskSummary[] {
    let names: string[];
    try {
      names = readdirSync(this.layout.tasksDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => /^T-\d+\.yaml$/.test(name))
      .map((name) => this.read(name.slice(0, -'.yaml'.length)))
      .filter((task): task is TaskSummary => task?.status === 'in-progress' && task.projects.includes(project));
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
    return {
      id: snapshot.id,
      title: snapshot.title,
      status: snapshot.status,
      projects: snapshot.projects,
      ...groupsOf(snapshot.estimate?.parts),
      ...(snapshot.startedAt === undefined ? {} : { startedAt: snapshot.startedAt }),
    };
  }
}

function groupsOf(parts: readonly { readonly group?: string }[] | undefined): { groups?: string[] } {
  const groups = [...new Set((parts ?? []).flatMap((part) => (part.group === undefined ? [] : [part.group])))];
  return groups.length === 0 ? {} : { groups };
}
