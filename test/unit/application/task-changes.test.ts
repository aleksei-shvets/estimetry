import { describe, expect, it } from 'vitest';
import { changesOf } from '../../../src/application/task/task-changes.js';
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

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
let n = 0;
const meta = (hhmm: string) => ({ id: `e-${++n}`, at: at(hhmm), author: Author.of('dev@example.com') });
const estimate = (...groups: (string | undefined)[]) =>
  Estimate.of({
    parts: groups.map((group, i) =>
      EstimatePart.of({ id: `p${i}`, name: `p${i}`, ...(group === undefined ? {} : { group }), hours: ThreePointEstimate.of({ optimistic: 1, likely: 1, pessimistic: 1 }) }),
    ),
  });

describe('the changes of a task', () => {
  it('are the groups of its current and its first estimate, each once', () => {
    const api = ProjectId.parse('api');
    const task = Task.create({ id: TaskId.parse('T-1'), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta('08:00'));
    expect(changesOf(task)).toEqual([]);
    task.saveEstimate(estimate('auth', 'auth', undefined, 'billing'), undefined, meta('08:10'));
    expect(changesOf(task)).toEqual(['auth', 'billing']);
    task.start(api, meta('09:00'));
    const revision = EstimateRevision.of({ estimate: estimate('auth', 'search'), reason: 'billing dropped', category: 'missed-analysis', spent: 'include', at: at('10:00'), covers: [] });
    task.reviseEstimate(revision, meta('10:00'));
    expect(changesOf(task)).toEqual(['auth', 'search', 'billing']);
  });
});
