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
 * The state after an event of the task: the only way the state changes, for
 * new events and for events read from the journal alike. The state given is
 * left as it was.
 */
export function applyEvent(state: TaskState, event: TaskEvent): TaskState {
  const ts = Timestamp.parse(event.ts);
  const s: TaskState = { ...state, lastEventAt: later(state.lastEventAt, ts) };
  switch (event.type) {
    case 'task.created':
      throw new InvalidValue(`task ${state.id.toString()} is created twice`);
    case 'task.started':
      return { ...s, status: 'in-progress', startedAt: event.data.at === undefined ? ts : Timestamp.parse(event.data.at) };
    case 'task.estimated':
      return {
        ...s,
        status: 'estimated',
        estimated: true,
        estimate: Estimate.fromData(event.data.estimate),
        ...(event.data.taskType === undefined ? {} : { type: TaskType.restore(event.data.taskType) }),
      };
    case 'task.manual-time-recorded': {
      const manual = ManualTime.fromData(event.data);
      return {
        ...s,
        manual: [...s.manual, { manual, recordedAt: ts }],
        ...(manual.part === undefined ? {} : { lastPartRecordAt: ts }),
        ...(manual.at === undefined ? {} : { lastEventAt: later(s.lastEventAt, manual.at) }),
      };
    }
    case 'task.extra-recorded':
      return { ...s, extras: [...s.extras, { id: event.id, at: ts, extra: Extra.fromData(event.data) }] };
    case 'task.estimate-revised':
      return applyRevision(s, event);
    case 'task.parallel-mode-enabled':
      return { ...s, parallelMode: [...s.parallelMode, { enabledAt: ts, change: event.data }] };
    case 'task.parallel-mode-disabled':
      return { ...s, parallelMode: endParallelMode(s.parallelMode, ts, true) };
    case 'task.closed':
      return applyClosed(s, event);
    case 'task.reopened':
      return applyReopened(s, ts);
    case 'task.retro-recorded':
      return { ...s, retro: { reasons: event.data.reasons, lesson: event.data.lesson, recordedAt: ts } };
    case 'task.attached':
      return event.project === undefined || s.projects.some((project) => project.value === event.project)
        ? s
        : { ...s, projects: [...s.projects, ProjectId.parse(event.project)] };
  }
}
