import { describe, expect, it } from 'vitest';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { Extra } from '../../../src/domain/measurement/extra.js';
import { ManualTime } from '../../../src/domain/measurement/manual-time.js';
import { ParallelModeChange } from '../../../src/domain/measurement/parallel-mode.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import type { EventMeta } from '../../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import {
  EstimateLocked,
  ParallelModeConflict,
  TaskNotStarted,
  UnknownEstimatePart,
} from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';

let seq = 0;
function meta(time = '10:00'): EventMeta {
  seq += 1;
  return { id: `e-${seq}`, at: Timestamp.parse(`2026-10-27T${time}:00.000Z`), author: Author.of('dev@example.com') };
}

const api = ProjectId.parse('api');

function newTask(): Task {
  return Task.create({ id: TaskId.fromNumber(1), title: 'Webhook', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('09:00'));
}

function estimate(): Estimate {
  return Estimate.of({
    parts: [
      EstimatePart.of({ id: 'impl', name: 'impl', hours: ThreePointEstimate.of({ optimistic: 1, likely: 2, pessimistic: 4 }) }),
      EstimatePart.of({ id: 'tests', name: 'tests', kind: 'auto-tests', hours: ThreePointEstimate.of({ optimistic: 1, likely: 1, pessimistic: 2 }) }),
    ],
  });
}

const manual = (minutes: number, time?: string) =>
  ManualTime.of({
    kind: 'user',
    duration: Duration.ofMinutes(minutes),
    ...(time ? { at: Timestamp.parse(`2026-10-27T${time}:00.000Z`) } : {}),
    description: 'manual testing',
  });

describe('Task estimate', () => {
  it('becomes estimated, takes the type of the estimate and starts without the calibration flag', () => {
    const task = newTask();
    task.saveEstimate(estimate(), TaskType.of('integration', DEFAULT_TASK_TYPES), meta());
    expect(task.toSnapshot()).toMatchObject({ status: 'estimated', estimated: true, type: 'integration' });
    expect(task.estimate?.total.likely).toBe(3);
    task.start(api, meta('10:05'));
    expect(task.pullEvents().map((e) => e.type)).toEqual(['task.created', 'task.estimated', 'task.started']);
    expect(task.toSnapshot()).toMatchObject({ status: 'in-progress', estimated: true });
  });

  it('can be replaced before the start and is locked after it', () => {
    const task = newTask();
    task.saveEstimate(estimate(), undefined, meta());
    task.saveEstimate(estimate(), undefined, meta('10:01'));
    expect(task.pullEvents().filter((e) => e.type === 'task.estimated')).toHaveLength(2);
    task.start(api, meta('10:05'));
    expect(() => task.saveEstimate(estimate(), undefined, meta())).toThrow(EstimateLocked);
  });
});

describe('Task start', () => {
  it('records a backdated start, even before the task was created', () => {
    const task = newTask();
    task.start(api, meta('10:00'), Timestamp.parse('2026-10-26T09:00:00.000Z'));
    expect(task.startedAt?.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(task.pullEvents().at(-1)).toMatchObject({
      ts: '2026-10-27T10:00:00.000Z',
      data: { estimated: false, at: '2026-10-26T09:00:00.000Z' },
    });
  });
});

describe('Task records', () => {
  it('need a task in progress', () => {
    const task = newTask();
    expect(() => task.recordManualTime(manual(40), meta())).toThrow(TaskNotStarted);
    expect(() => task.recordManualTime(manual(40), meta())).toThrow(/emt start T-1/);
    expect(() => task.recordExtra(Extra.of({ category: 'rework', description: 'x' }), meta())).toThrow(TaskNotStarted);
    expect(() => task.enableParallelMode(ParallelModeChange.of({}), meta())).toThrow(TaskNotStarted);
  });

  it('keep manual time, with its end not before the start', () => {
    const task = newTask();
    task.start(api, meta('10:00'));
    task.recordManualTime(manual(40), meta('11:00'));
    task.recordManualTime(manual(25, '10:30'), meta('11:01'));
    expect(() => task.recordManualTime(manual(25, '09:59'), meta())).toThrow(InvalidValue);
    expect(task.manualTime.map((m) => m.toData())).toEqual([
      { kind: 'user', durationMs: 2_400_000, description: 'manual testing' },
      { kind: 'user', durationMs: 1_500_000, at: '2026-10-27T10:30:00.000Z', description: 'manual testing' },
    ]);
  });

  it('switch parallel mode on and off once each, with known parts only', () => {
    const task = newTask();
    task.saveEstimate(estimate(), undefined, meta());
    task.start(api, meta('10:00'));
    expect(() => task.enableParallelMode(ParallelModeChange.of({ parts: ['nope'] }), meta())).toThrow(
      /expected one of: impl, tests/,
    );
    task.enableParallelMode(ParallelModeChange.of({ agents: 3, parts: ['impl'], budgetShare: 0.6 }), meta('10:10'));
    expect(task.isParallel).toBe(true);
    expect(() => task.enableParallelMode(ParallelModeChange.of({}), meta())).toThrow(ParallelModeConflict);
    task.disableParallelMode(meta('10:40'));
    expect(() => task.disableParallelMode(meta())).toThrow(ParallelModeConflict);
    expect(task.parallelMode).toEqual([
      {
        enabledAt: '2026-10-27T10:10:00.000Z',
        disabledAt: '2026-10-27T10:40:00.000Z',
        change: { agents: 3, parts: ['impl'], budgetShare: 0.6 },
      },
    ]);
  });

  it('reject parts when the task has no estimate', () => {
    const task = newTask();
    task.start(api, meta());
    expect(() => task.enableParallelMode(ParallelModeChange.of({ parts: ['impl'] }), meta())).toThrow(UnknownEstimatePart);
  });

  it('rebuilt from the journal equal the snapshot', () => {
    const task = newTask();
    task.saveEstimate(estimate(), TaskType.of('bugfix', DEFAULT_TASK_TYPES), meta());
    task.start(api, meta('10:00'), Timestamp.parse('2026-10-27T09:30:00.000Z'));
    task.recordManualTime(manual(40), meta('11:00'));
    task.recordExtra(Extra.of({ category: 'environment', description: 'Node', time: Duration.ofMinutes(30) }), meta('11:01'));
    task.enableParallelMode(ParallelModeChange.of({ reason: 'deadline', agents: 2 }), meta('11:02'));
    task.disableParallelMode(meta('11:30'));
    const events = task.pullEvents();
    expect(Task.fromEvents(events).toSnapshot()).toEqual(task.toSnapshot());
    expect(Task.rehydrate(task.toSnapshot()).toSnapshot()).toEqual(task.toSnapshot());
    expect(task.version).toBe(7);
  });
});
