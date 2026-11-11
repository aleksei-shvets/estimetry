import { describe, expect, it } from 'vitest';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { EstimateRevision } from '../../../src/domain/estimate/estimate-revision.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { Extra } from '../../../src/domain/measurement/extra.js';
import { ManualTime } from '../../../src/domain/measurement/manual-time.js';
import { ParallelModeChange } from '../../../src/domain/measurement/parallel-mode.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import type { EventMeta } from '../../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task, type TaskSnapshot } from '../../../src/domain/task/task.js';
import { applyEvent } from '../../../src/domain/task/task-apply.js';
import { snapshotOf } from '../../../src/domain/task/task-snapshot.js';
import { initialState, type TaskState } from '../../../src/domain/task/task-state.js';
import { TaskNotClosed, TaskNotStarted } from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { isClosed, isInProgress, TASK_STATUSES } from '../../../src/domain/task/task-status.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
let seq = 0;
const meta = (time: string): EventMeta => ({ id: `e-${++seq}`, at: at(time), author: Author.of('dev@example.com') });
const api = ProjectId.parse('api');
const web = ProjectId.parse('web');
const type = (value: string) => TaskType.of(value, DEFAULT_TASK_TYPES);

function estimate(likely: number): Estimate {
  return Estimate.of({
    parts: [EstimatePart.of({ id: 'a', name: 'a', group: 'a', hours: ThreePointEstimate.of({ optimistic: likely, likely, pessimistic: likely }) })],
  });
}

function created(): Task {
  return Task.create({ id: TaskId.fromNumber(2), title: 'X', type: type('feature'), project: api, spawnedFrom: TaskId.fromNumber(1) }, meta('08:00'));
}

/** A task through every kind of event: estimate, start, attach, manual time, extra, parallel mode, revision, close, reopen, close, retro. */
function lived(): Task {
  const task = created();
  task.saveEstimate(estimate(10), type('integration'), meta('08:30'));
  task.start(api, meta('09:00'));
  task.attach(web, meta('09:10'));
  task.recordManualTime(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(30), at: at('10:00'), description: 'review' }), meta('10:05'));
  task.recordManualTime(ManualTime.of({ kind: 'agent', duration: Duration.ofMinutes(5), description: 'cli', part: 'a' }), meta('10:06'));
  task.recordExtra(Extra.of({ category: 'rework', description: 'retries' }), meta('10:10'));
  task.enableParallelMode(ParallelModeChange.of({ agents: 2 }), meta('10:20'));
  task.disableParallelMode(meta('10:30'));
  task.reviseEstimate(
    EstimateRevision.of({ estimate: estimate(12), type: 'bugfix', reason: 'retries', category: 'missed-analysis', spent: 'exclude', at: at('11:00'), lostFrom: at('10:40'), covers: [] }),
    meta('11:00'),
  );
  task.close({ at: at('12:00'), outcome: 'completed' }, meta('12:00'));
  task.reopen(meta('12:30'));
  task.close({ at: at('13:00'), outcome: 'renegotiated', spawned: TaskId.fromNumber(3) }, meta('13:00'));
  task.recordRetro(['a: retries were not in the plan'], 'ask about retries', meta('13:10'));
  return task;
}

describe('the aggregate gives value objects', () => {
  it('type, author, projects and the task it was spawned from', () => {
    const task = lived();
    expect(task.type).toEqual(type('bugfix'));
    expect(task.firstType).toEqual(type('integration'));
    expect(task.author).toEqual(Author.of('dev@example.com'));
    expect(task.projects).toEqual([api, web]);
    expect(task.homeProject).toEqual(api);
    expect(task.spawnedFrom).toEqual(TaskId.fromNumber(1));
    expect(task.title).toBe('X');
  });

  it('closings, revisions, the retro, extra work and manual records with moments as Timestamp', () => {
    const task = lived();
    expect(task.closures).toEqual([
      { at: at('12:00'), outcome: 'completed', recordedAt: at('12:00'), reopenedAt: at('12:30') },
      { at: at('13:00'), outcome: 'renegotiated', spawned: TaskId.fromNumber(3), recordedAt: at('13:00') },
    ]);
    expect(task.closure?.spawned).toEqual(TaskId.fromNumber(3));
    expect(task.revisions[0]).toMatchObject({ at: at('11:00'), lostFrom: at('10:40'), typeBefore: type('integration'), typeAfter: type('bugfix') });
    expect(task.retro?.recordedAt).toEqual(at('13:10'));
    expect(task.extraRecords.map(({ id, at: moment }) => [typeof id, moment])).toEqual([['string', at('10:10')]]);
    expect(task.manualRecords.map((record) => record.recordedAt)).toEqual([at('10:05'), at('10:06')]);
  });

  it('a snapshot without the records of extra work and manual time gives undefined, not an empty string', () => {
    const { extraRecords: _extras, manualRecordedAt: _manual, ...snapshot } = lived().toSnapshot();
    const task = Task.rehydrate(snapshot as TaskSnapshot);
    expect(task.extraRecords.map((record) => [record.id, record.at])).toEqual([[undefined, undefined]]);
    expect(task.manualRecords.map((record) => record.recordedAt)).toEqual([undefined, undefined]);
  });

  it('the snapshot of a journal with every event survives a round trip unchanged', () => {
    const task = lived();
    const snapshot = task.toSnapshot();
    expect(Task.fromEvents(task.pullEvents()).toSnapshot()).toEqual(snapshot);
    expect(Task.rehydrate(snapshot).toSnapshot()).toEqual(snapshot);
    expect(JSON.stringify(Task.rehydrate(JSON.parse(JSON.stringify(snapshot)) as TaskSnapshot).toSnapshot())).toBe(JSON.stringify(snapshot));
  });
});

describe('narrow getters instead of casts', () => {
  it('the start and the closing of a task that has them', () => {
    const task = lived();
    expect(task.requireStartedAt()).toEqual(at('09:00'));
    expect(task.requireClosedAt()).toEqual(at('13:00'));
  });

  it('throw a domain error when the moment is not there yet', () => {
    const task = created();
    expect(() => task.requireStartedAt()).toThrow(TaskNotStarted);
    expect(() => task.requireClosedAt()).toThrow(TaskNotClosed);
    task.start(api, meta('09:00'));
    expect(() => task.requireClosedAt()).toThrow(TaskNotClosed);
  });

  it('the interval of a manual record exists only with its end', () => {
    const timed = ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(30), at: at('10:00'), description: 'review' });
    expect(timed.interval()?.start.toISOString()).toBe(at('09:30').toISOString());
    expect(timed.interval()?.end.toISOString()).toBe(at('10:00').toISOString());
    expect(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(30), description: 'review' }).interval()).toBeUndefined();
  });
});

describe('status without strings', () => {
  it('the aggregate tells whether it is closed or in progress', () => {
    const task = created();
    expect([task.isInProgress, task.isClosed]).toEqual([false, false]);
    task.start(api, meta('09:00'));
    expect([task.isInProgress, task.isClosed]).toEqual([true, false]);
    task.close({ at: at('10:00'), outcome: 'completed' }, meta('10:00'));
    expect([task.isInProgress, task.isClosed]).toEqual([false, true]);
  });

  it('functions of a status read from a snapshot', () => {
    expect(TASK_STATUSES.filter(isInProgress)).toEqual(['in-progress']);
    expect(TASK_STATUSES.filter(isClosed)).toEqual(['closed']);
  });
});

describe('the state of the aggregate is immutable', () => {
  it('applying an event gives a new state and leaves the one it was given as it was', () => {
    const [first, ...rest] = lived().pullEvents();
    if (first?.type !== 'task.created') {
      throw new Error('the journal starts with task.created');
    }
    const version = { count: 1, lastEventId: first.id };
    const states: TaskState[] = [initialState(first)];
    const seen: string[] = [JSON.stringify(snapshotOf(states[0] as TaskState, version))];
    for (const event of rest) {
      const next = applyEvent(states.at(-1) as TaskState, event);
      expect(next).not.toBe(states.at(-1));
      states.push(next);
      seen.push(JSON.stringify(snapshotOf(next, version)));
    }
    expect(states.map((state) => JSON.stringify(snapshotOf(state, version)))).toEqual(seen);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('periods of parallel mode keep their moments as Timestamp', () => {
    const task = lived();
    expect(task.parallelMode).toEqual([{ enabledAt: at('10:20'), disabledAt: at('10:30'), change: { agents: 2, parts: [] } }]);
    expect(task.toSnapshot().parallelMode).toEqual([{ enabledAt: at('10:20').toISOString(), disabledAt: at('10:30').toISOString(), change: { agents: 2, parts: [] } }]);
  });
});
