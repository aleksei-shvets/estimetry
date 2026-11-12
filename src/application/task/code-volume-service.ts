import { countedCommits, mergeFiles } from '../../domain/code/code-volume.js';
import type {
  CheckpointRecorded,
  CommitRecorded,
  PlanStarted,
  ProgressRecord,
  ProjectCode,
} from '../../domain/progress/progress-records.js';
import { fileList } from '../../domain/progress/progress-records.js';
import type { Task } from '../../domain/task/task.js';
import type { CodeMeasurer } from '../ports/code-measurer.js';
import type { ProjectPlans } from '../ports/project-plans.js';
import { nearOf, type WorkingCopy } from '../shared/working-copy.js';

/**
 * Code volume of a task by project, measured right before it closes
 * (task-cards spec): recorded commits still reachable from `HEAD`, else the
 * author's commits since the base, plus what is not committed yet.
 */
export class CodeVolumeService {
  constructor(
    private readonly plans: Pick<ProjectPlans, 'archives'>,
    private readonly git: CodeMeasurer,
  ) {}

  measure(task: Task, records: readonly ProgressRecord[], where: WorkingCopy = {}): ProjectCode[] {
    const readings = this.plans.archives(task.projects, { ...nearOf(where), changes: task.changes });
    return task.projects.map(({ value: project }) => {
      const root = readings.find((reading) => reading.project.value === project)?.root;
      if (root === undefined) {
        return unknown(project, 'not-on-this-machine');
      }
      try {
        return this.project(project, root, records);
      } catch {
        return unknown(project, 'git-failed');
      }
    });
  }

  private project(project: string, root: string, records: readonly ProgressRecord[]): ProjectCode {
    const uncommitted = this.git.uncommitted(root);
    if (uncommitted === undefined) {
      return unknown(project, 'not-a-git-repository');
    }
    const base = baseOf(project, records);
    const commits = records.filter((record): record is CommitRecorded => record.type === 'commit.recorded' && record.project === project);
    if (commits.length > 0) {
      const checks = new Map(commits.map((commit) => [commit.data.sha, this.git.reachable(root, commit.data.sha)]));
      const verifiable = [...checks.values()].every((value) => value !== undefined);
      const counted = countedCommits(commits, verifiable ? (sha) => checks.get(sha) === true : undefined);
      const unreachable = verifiable ? [...checks.values()].filter((value) => value === false).length : undefined;
      const recorded = new Set(commits.map((commit) => commit.data.sha));
      const authored = base === undefined ? undefined : this.git.authorCommits(root, base);
      // The author's commits since the base that were never recorded (a hook installed mid-task, a lost record) count too.
      const missing = (authored ?? []).filter((commit) => !recorded.has(commit.sha));
      const uncovered = authored === undefined ? undefined : missing.length;
      return {
        project,
        source: 'commits',
        ...fileList(mergeFiles([...counted.map((commit) => commit.data.files), ...missing.map((commit) => commit.files), uncommitted])),
        ...(verifiable ? {} : { unverified: true }),
        ...(unreachable === undefined ? {} : { unreachable }),
        ...(uncovered === undefined ? {} : { uncovered }),
      };
    }
    if (base === undefined) {
      return unknown(project, 'no-base');
    }
    if (this.git.reachable(root, base) !== true) {
      return unknown(project, 'base-not-ancestor');
    }
    const authored = this.git.authorCommits(root, base);
    if (authored === undefined) {
      return unknown(project, 'git-failed');
    }
    return { project, source: 'snapshots', ...fileList(mergeFiles([...authored.map((commit) => commit.files), uncommitted])) };
  }
}

/** `HEAD` when the task started, else at the first checkpoint of the project. */
function baseOf(project: string, records: readonly ProgressRecord[]): string | undefined {
  for (const record of records) {
    if (record.type === 'plan.started') {
      const head = (record as PlanStarted).data.projects.find((p) => p.project === project)?.head;
      if (head !== undefined) {
        return head;
      }
    }
  }
  const checkpoint = records.find(
    (record): record is CheckpointRecorded =>
      record.type === 'checkpoint.recorded' && record.project === project && record.data.head !== undefined,
  );
  return checkpoint?.data.head;
}

/** No lines at all: a partial count would pass for the volume of the task. */
function unknown(project: string, reason: string): ProjectCode {
  return { project, source: 'unknown', reason, ...fileList([]) };
}
