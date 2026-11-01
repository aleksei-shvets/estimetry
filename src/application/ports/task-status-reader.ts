/** What the hook receiver needs of a task, read from its snapshot without checking the journal. */
export interface TaskSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly projects: readonly string[];
}

export interface TaskStatusReader {
  summary(task: string): TaskSummary | undefined;
  inProgress(project: string): TaskSummary[];
}
