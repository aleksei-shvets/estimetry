import { Estimate } from '../estimate/estimate.js';
import { Extra } from '../measurement/extra.js';
import { ManualTime } from '../measurement/manual-time.js';
import { ProjectId } from '../project/project-id.js';
import { InvalidValue } from '../shared/domain-error.js';
import { Timestamp } from '../shared/timestamp.js';
import { applyClosed, applyReopened, endParallelMode } from './task-closures.js';
import type { TaskEvent } from './task-events.js';
import { applyRevision } from './task-revisions.js';
import { later, type TaskState } from './task-state.js';
import { TaskType } from './task-type.js';

/**
 * Applies an event of the task to its state: the only way the state changes,
 * for new events and for events read from the journal alike.
 */
export function applyEvent(state: TaskState, event: TaskEvent): void {
  const ts = Timestamp.parse(event.ts);
  state.lastEventAt = later(state.lastEventAt, ts);
  switch (event.type) {
    case 'task.created':
      throw new InvalidValue(`task ${state.id.toString()} is created twice`);
    case 'task.started':
      state.status = 'in-progress';
      state.startedAt = event.data.at === undefined ? ts : Timestamp.parse(event.data.at);
      break;
    case 'task.estimated':
      state.status = 'estimated';
      state.estimated = true;
      state.estimate = Estimate.fromData(event.data.estimate);
      if (event.data.taskType !== undefined) {
        state.type = TaskType.restore(event.data.taskType);
      }
      break;
    case 'task.manual-time-recorded': {
      const manual = ManualTime.fromData(event.data);
      state.manual.push({ manual, recordedAt: ts });
      if (manual.part !== undefined) {
        state.lastPartRecordAt = ts;
      }
      if (manual.at !== undefined) {
        state.lastEventAt = later(state.lastEventAt, manual.at);
      }
      break;
    }
    case 'task.extra-recorded':
      state.extras.push({ id: event.id, at: ts, extra: Extra.fromData(event.data) });
      break;
    case 'task.estimate-revised':
      applyRevision(state, event);
      break;
    case 'task.parallel-mode-enabled':
      state.parallelMode.push({ enabledAt: event.ts, change: event.data });
      break;
    case 'task.parallel-mode-disabled':
      endParallelMode(state, event.ts, true);
      break;
    case 'task.closed':
      applyClosed(state, event);
      break;
    case 'task.reopened':
      applyReopened(state, ts);
      break;
    case 'task.retro-recorded':
      state.retro = { reasons: event.data.reasons, lesson: event.data.lesson, recordedAt: ts };
      break;
    case 'task.attached':
      if (event.project !== undefined && !state.projects.some((project) => project.value === event.project)) {
        state.projects.push(ProjectId.parse(event.project));
      }
      break;
  }
}
