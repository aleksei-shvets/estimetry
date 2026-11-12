import { describe, expect, it } from 'vitest';
import { groupsOf } from '../../../src/domain/estimate/plan-changes.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { EstimateRevision } from '../../../src/domain/estimate/estimate-revision.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';
import { snapshotChanges } from '../../../src/domain/task/task-snapshot.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
let n = 0;
const meta = (hhmm: string) => ({ id: `e-${++n}`, at: at(hhmm), author: Author.of('dev@example.com') });
const estimate = (...groups: (string | undefined)[]) =>
  Estimate.of({
    parts: groups.map((group, i) =>
      EstimatePart.of({ id: `p${i}`, name: `p${i}`, ...(group === undefined ? {} : { group }), hours: ThreePointEstimate.of({ optimistic: 1, likely: 1, pessimistic: 1 }) }),
    ),
  });

/** The changes of a task as the CLI sees them (the aggregate) and as a hook does (its snapshot, data only); both the same. */
const changesOf = (task: Task) => {
  expect(snapshotChanges(task.toSnapshot())).toEqual(task.changes);
  expect(Task.rehydrate(task.toSnapshot()).changes).toEqual(task.changes);
  return task.changes;
};
const revise = (task: Task, at: string, ...groups: string[]) =>
  task.reviseEstimate(
    EstimateRevision.of({ estimate: estimate(...groups), reason: 'plan changed', category: 'missed-analysis', spent: 'include', at: Timestamp.parse(`2026-10-27T${at}:00.000Z`), covers: [] }),
    meta(at),
  );

describe('the changes of a task', () => {
  it('groups of parts are each once, in the order of the parts, without parts that have none', () => {
    expect(groupsOf([{ group: 'b' }, {}, { group: 'a' }, { group: 'b' }])).toEqual(['b', 'a']);
    expect(groupsOf(undefined)).toEqual([]);
    expect(estimate('auth', undefined, 'auth').groups).toEqual(['auth']);
  });

  it('are those of the estimate before the start, and gain those of every revision after it', () => {
    const api = ProjectId.parse('api');
    const task = Task.create({ id: TaskId.parse('T-1'), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
    expect(changesOf(task)).toEqual([]);
    task.saveEstimate(estimate('old'), undefined, meta('08:05'));
    task.saveEstimate(estimate('auth', 'auth', undefined, 'billing'), undefined, meta('08:10'));
    // Before the start the estimate is still free: a replaced one leaves no changes.
    expect(changesOf(task)).toEqual(['auth', 'billing']);
    task.start(api, meta('09:00'));
    revise(task, '10:00', 'auth', 'search');
    revise(task, '11:00', 'auth');
    // A change of an intermediate revision stays a change of the task, as the first ones do.
    expect(changesOf(task)).toEqual(['auth', 'billing', 'search']);
  });

  it('of a snapshot before schema 4 are the groups of its current and first estimate, the rule before the list', () => {
    const api = ProjectId.parse('api');
    const task = Task.create({ id: TaskId.parse('T-2'), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
    task.saveEstimate(estimate('a'), undefined, meta('08:05'));
    task.start(api, meta('09:00'));
    revise(task, '10:00', 'a', 'b');
    revise(task, '11:00', 'c');
    const { changes: _list, ...older } = task.toSnapshot();
    expect(snapshotChanges({ ...older, schemaVersion: 3 })).toEqual(['c', 'a']);
    // Schema 4 leaves an empty list out: no changes, not the older rule.
    expect(snapshotChanges({ ...older, schemaVersion: 4 })).toEqual([]);
    expect(changesOf(task)).toEqual(['a', 'b', 'c']);
  });

  it('gain the groups of an estimate made after the start and of a revision after a reopening; the journal gives the same', () => {
    const api = ProjectId.parse('api');
    const task = Task.create({ id: TaskId.parse('T-3'), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
    task.start(api, meta('09:00'));
    task.reviseEstimate(EstimateRevision.of({ estimate: estimate('late'), reason: 'first one', category: 'missed-analysis', at: at('10:00'), covers: [] }), meta('10:00'));
    expect(changesOf(task)).toEqual(['late']);
    task.close({ at: at('11:00'), outcome: 'completed' }, meta('11:00'));
    task.reopen(meta('12:00'));
    revise(task, '13:00', 'again');
    expect(changesOf(task)).toEqual(['late', 'again']);
    expect(Task.fromEvents(task.pullEvents()).changes).toEqual(['late', 'again']);
  });

  it('of a snapshot before schema 4 are the same for the aggregate and for a reader without it', () => {
    const api = ProjectId.parse('api');
    const task = Task.create({ id: TaskId.parse('T-4'), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
    task.saveEstimate(estimate('a'), undefined, meta('08:05'));
    task.start(api, meta('09:00'));
    revise(task, '10:00', 'b');
    const { changes: _list, ...older } = task.toSnapshot();
    const snapshot = { ...older, schemaVersion: 3 };
    expect(Task.rehydrate(snapshot).changes).toEqual(snapshotChanges(snapshot));
    expect(snapshotChanges(snapshot)).toEqual(['b', 'a']);
  });
});
