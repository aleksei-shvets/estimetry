import type { ProjectId } from '../project/project-id.js';
import { InvalidValue } from '../shared/domain-error.js';
import type { TaskCreated } from './task-events.js';
import type { TaskId } from './task-id.js';
import type { TaskType } from './task-type.js';

const MAX_TITLE_LENGTH = 200;

/** What a new task is made of. */
export interface NewTask {
  readonly id: TaskId;
  readonly title: string;
  readonly type: TaskType;
  readonly ticket?: string;
  readonly project: ProjectId;
  readonly spawnedFrom?: TaskId;
}

/** The data of `task.created`: a title that is not empty nor too long, a ticket key that is not blank. */
export function createdData(input: NewTask): TaskCreated['data'] {
  const title = input.title.trim();
  if (title === '') {
    throw new InvalidValue('task title must not be empty');
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new InvalidValue(`task title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  const ticket = input.ticket?.trim();
  if (ticket === '') {
    throw new InvalidValue('ticket key must not be empty');
  }
  return {
    title,
    taskType: input.type.value,
    ...(ticket === undefined ? {} : { ticket }),
    ...(input.spawnedFrom === undefined ? {} : { spawnedFrom: input.spawnedFrom.toString() }),
  };
}
