import { beforeEach, describe, expect, it } from 'vitest';
import { ChangeCompletions } from '../../../src/application/hooks/change-completions.js';
import { FlowProjectPlans } from '../../../src/application/hooks/flow-plans.js';
import type { ProgressSeen, ProgressState } from '../../../src/application/ports/progress-state.js';
import type { TaskSummary } from '../../../src/application/ports/task-status-reader.js';
import { TaskPlanProgress } from '../../../src/application/task/task-plan-progress.js';
import { Estimate } from '../../../src/domain/estimate/estimate.js';
import { EstimatePart } from '../../../src/domain/estimate/estimate-part.js';
import { ThreePointEstimate } from '../../../src/domain/estimate/three-point-estimate.js';
import type { ChangeCompleted, ProgressRecord } from '../../../src/domain/progress/progress-records.js';
import { Project } from '../../../src/domain/project/project.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';
import { noneFlow } from '../../../src/integrations/flows/none/none-flow.js';
import { openSpecFlow } from '../../../src/integrations/flows/openspec/openspec-flow.js';
import { FakeAuthorProvider, RecordingErrorReporter, SequentialIdGenerator } from '../../support/fakes.js';
import { InMemoryProjectConfigFile, InMemoryProjectFiles, ListRegistry } from '../../support/in-memory-files.js';
import { InMemoryEventJournal, InMemoryProjectRepository } from '../../support/in-memory-repositories.js';
import { InMemoryCloseProposals } from '../../support/closing-fakes.js';
import { ChangeArchives } from '../../../src/application/shared/change-archives.js';
import { EventMetaSource } from '../../../src/application/shared/event-meta-source.js';
import { ProgressLog } from '../../../src/application/hooks/progress-log.js';

const START = '2026-10-26T18:57:00.000Z';
const START_MS = Date.parse(START);
const NOW = Timestamp.parse('2026-11-02T10:00:00.000Z');
const author = Author.of('dev@example.com');

class InMemoryProgressState implements ProgressState {
  readonly saved = new Map<string, ProgressSeen>();
  read(task: string): ProgressSeen | undefined {
    return this.saved.get(task);
  }
  write(task: string, seen: ProgressSeen): void {
    this.saved.set(task, seen);
  }
}

let files: InMemoryProjectFiles;
let projects: InMemoryProjectRepository;
let journal: InMemoryEventJournal;
let state: InMemoryProgressState;
let errors: RecordingErrorReporter;
let inProgress: TaskSummary[];
let completions: ChangeCompletions;
let plans: FlowProjectPlans;
let proposals: InMemoryCloseProposals;

function project(id: string, root: string, flow: string | null = 'openspec'): void {
  projects.projects.push(Project.register({ id: ProjectId.parse(id), name: id, path: root }, author, Timestamp.parse(START)));
  files.write(`${root}/.keep`, '');
  if (flow !== null) {
    files.write(`${root}/.estimetry/config.yaml`, `flow: ${flow}\n`);
  }
}

function change(root: string, name: string, tasks = '- [ ] a\n'): void {
  files.write(`${root}/openspec/changes/${name}/tasks.md`, tasks);
}

/** Moves a change into the archive like `mv`: the directory's ctime becomes the moment of the move. */
function archive(root: string, name: string, date: string, changedAt = START_MS + 3_600_000): void {
  const from = `${root}/openspec/changes/${name}/`;
  const to = `${root}/openspec/changes/archive/${date}-${name}/`;
  const moved = [...files.files.entries()].filter(([path]) => path.startsWith(from));
  for (const [path, file] of moved) {
    files.files.delete(path);
    files.files.set(to + path.slice(from.length), file);
  }
  if (moved.length === 0) {
    files.write(`${to}tasks.md`, '- [x] a\n');
  }
  files.changed.set(to.slice(0, -1), changedAt);
}

function unarchive(root: string, name: string, date: string): void {
  const from = `${root}/openspec/changes/archive/${date}-${name}/`;
  for (const [path, file] of [...files.files.entries()].filter(([p]) => p.startsWith(from))) {
    files.files.delete(path);
    files.files.set(`${root}/openspec/changes/${name}/${path.slice(from.length)}`, file);
  }
}

function summary(id: string, groups: string[] = [], taskProjects = ['api']): TaskSummary {
  return { id, title: id, status: 'in-progress', startedAt: START, projects: taskProjects, ...(groups.length === 0 ? {} : { groups }) };
}

const records = (task: string): ProgressRecord[] => journal.readRecords(TaskId.parse(task));
const completed = (task: string): ChangeCompleted['data'][] =>
  records(task).flatMap((record) => (record.type === 'change.completed' ? [record.data] : []));

beforeEach(() => {
  files = new InMemoryProjectFiles();
  projects = new InMemoryProjectRepository();
  journal = new InMemoryEventJournal();
  state = new InMemoryProgressState();
  errors = new RecordingErrorReporter();
  inProgress = [];
  proposals = new InMemoryCloseProposals();
  plans = new FlowProjectPlans(new InMemoryProjectConfigFile(files), new ListRegistry([openSpecFlow, noneFlow]), files, projects);
  completions = new ChangeCompletions(
    new ChangeArchives(plans, files),
    new ProgressLog(state, journal),
    { inProgress: () => inProgress },
    new EventMetaSource({ now: () => { throw new Error('the clock is not read here'); } }, new SequentialIdGenerator(), new FakeAuthorProvider()),
    errors,
    proposals,
  );
  project('api', '/work/api');
});

describe('change completions', () => {
  it('records an archived change of the task once, with the moment of the move', () => {
    const task = summary('T-1', ['plan-progress']);
    change('/work/api', 'plan-progress');
    completions.check(task, NOW);
    expect(records('T-1').map((r) => r.type)).toEqual(['plan.baseline']);

    archive('/work/api', 'plan-progress', '2026-11-02', START_MS + 7_200_000);
    completions.check(task, NOW);
    completions.check(task, NOW);
    expect(completed('T-1')).toEqual([
      {
        source: 'estimetry',
        project: 'api',
        change: 'plan-progress',
        directory: '2026-11-02-plan-progress',
        flow: 'openspec',
        completedAt: new Date(START_MS + 7_200_000).toISOString(),
        detectedAt: NOW.toISOString(),
        approximate: false,
      },
    ]);
    expect(errors.reports).toEqual([]);
  });

  it('writes nothing for a change of another task in the same project', () => {
    const b = summary('T-2', ['webhooks']);
    completions.check(b, NOW);
    change('/work/api', 'payments');
    archive('/work/api', 'payments', '2026-11-01');
    completions.check(b, NOW);
    expect(completed('T-2')).toEqual([]);

    const a = summary('T-1', ['payments']);
    completions.check(a, NOW);
    expect(completed('T-1').map((c) => c.change)).toEqual(['payments']);
  });

  it('gives a task without groups a change only while it is the one task in progress there', () => {
    const alone = summary('T-1');
    inProgress = [alone];
    completions.check(alone, NOW);
    archive('/work/api', 'first', '2026-11-01');
    completions.check(alone, NOW);
    expect(completed('T-1').map((c) => c.change)).toEqual(['first']);

    inProgress = [alone, summary('T-2')];
    archive('/work/api', 'second', '2026-11-02');
    completions.check(alone, NOW);
    expect(completed('T-1').map((c) => c.change)).toEqual(['first']);
  });

  it('records a change recreated and archived again under a new directory', () => {
    const task = summary('T-1', ['auth']);
    completions.check(task, NOW);
    archive('/work/api', 'auth', '2026-10-27');
    completions.check(task, NOW);
    change('/work/api', 'auth');
    archive('/work/api', 'auth', '2026-10-30');
    completions.check(task, NOW);
    expect(completed('T-1').map((c) => c.directory)).toEqual(['2026-10-27-auth', '2026-10-30-auth']);
  });

  it('on the first run puts old archives into the baseline and archives of the plan into approximate completions', () => {
    archive('/work/api', 'old', '2026-09-01');
    for (const name of ['a', 'b', 'c']) {
      archive('/work/api', name, '2026-10-28');
    }
    completions.check(summary('T-1', ['a', 'b', 'c', 'old']), NOW);
    const [baseline, ...rest] = records('T-1');
    expect(baseline).toMatchObject({ type: 'plan.baseline', data: { project: 'api', directories: ['2026-09-01-old'] } });
    expect(rest.map((r) => r.type)).toEqual(['change.completed', 'change.completed', 'change.completed']);
    expect(completed('T-1').every((c) => c.approximate && c.completedAt === '2026-10-28T00:00:00.000Z')).toBe(true);
  });

  it('takes the date of a directory whose ctime is older than the start: it was recreated, not moved', () => {
    const task = summary('T-1', ['cloned']);
    completions.check(task, NOW);
    archive('/work/api', 'cloned', '2026-10-27', START_MS - 1000);
    completions.check(task, NOW);
    expect(completed('T-1')).toMatchObject([{ change: 'cloned', approximate: true, completedAt: '2026-10-27T00:00:00.000Z' }]);
  });

  it('rebuilds a lost cache from the journal without repeating records', () => {
    const task = summary('T-1', ['a']);
    completions.check(task, NOW);
    archive('/work/api', 'a', '2026-11-01');
    completions.check(task, NOW);
    state.saved.clear();
    completions.check(task, NOW);
    expect(records('T-1').map((r) => r.type)).toEqual(['plan.baseline', 'change.completed']);
    expect(state.read('T-1')).toEqual({ directories: { api: ['2026-11-01-a'] } });
  });

  it('does nothing for projects with the flow none, without a config or not on this machine', () => {
    project('plain', '/work/plain', 'none');
    project('bare', '/work/bare', null);
    archive('/work/plain', 'x', '2026-11-01');
    completions.check(summary('T-1', ['x'], ['plain', 'bare', 'elsewhere']), NOW);
    expect(records('T-1')).toEqual([]);
    expect(errors.reports).toEqual([]);
  });

  it('reads the archive of the working copy the session runs in, not the first registered one', () => {
    projects.update(ProjectId.parse('api'), (p) => p.withPath('/work/api-wt'));
    files.write('/work/api-wt/.estimetry/config.yaml', 'flow: openspec\n');
    const task = summary('T-1', ['auth']);
    completions.check(task, NOW, '/work/api-wt');
    archive('/work/api-wt', 'auth', '2026-11-01');
    completions.check(task, NOW, '/work/api-wt/src');
    expect(completed('T-1').map((c) => c.change)).toEqual(['auth']);
  });

  it('keeps a directory of another task out of the cache, so the decision does not depend on it', () => {
    const alone = summary('T-1');
    const other = summary('T-2');
    inProgress = [alone, other];
    completions.check(alone, NOW);
    archive('/work/api', 'shared', '2026-11-01');
    completions.check(alone, NOW);
    expect(state.read('T-1')).toEqual({ directories: { api: [] } });
    inProgress = [alone];
    completions.check(alone, NOW);
    expect(completed('T-1').map((c) => c.change)).toEqual(['shared']);
  });

  it('stats only directories it has not seen, and writes the cache only when it changes', () => {
    const task = summary('T-1', ['a', 'b']);
    archive('/work/api', 'a', '2026-11-01');
    completions.check(task, NOW);
    const stats: string[] = [];
    files.changedAt = (path) => (stats.push(path), START_MS + 1000);
    let writes = 0;
    const write = state.write.bind(state);
    state.write = (t, seen) => (writes++, write(t, seen));
    completions.check(task, NOW);
    expect({ stats, writes }).toEqual({ stats: [], writes: 0 });
    archive('/work/api', 'b', '2026-11-02');
    completions.check(task, NOW);
    expect({ stats, writes }).toEqual({ stats: ['/work/api/openspec/changes/archive/2026-11-02-b'], writes: 1 });
  });

  it('leaves a proposal to close the task for an exact completion, with the session that noticed it', () => {
    const task = summary('T-1', ['a', 'b']);
    archive('/work/api', 'old', '2026-10-28');
    completions.check(task, NOW, undefined, 's1');
    expect(proposals.peek('T-1')).toBeUndefined(); // first run: approximate completions only
    archive('/work/api', 'a', '2026-11-01');
    archive('/work/api', 'b', '2026-11-02', START_MS + 9_000_000);
    completions.check(task, NOW, undefined, 's2');
    expect(proposals.peek('T-1')).toEqual({ change: 'b', project: 'api', completedAt: new Date(START_MS + 9_000_000).toISOString(), session: 's2' });
  });

  it('reports a failure instead of throwing', () => {
    files.list = () => {
      throw new Error('EIO');
    };
    expect(() => completions.check(summary('T-1', ['a']), NOW)).not.toThrow();
    expect(errors.reports).toHaveLength(1);
  });
});

describe('the progress of a task plan', () => {
  function startedTask(groups: { group?: string; likely: number }[], taskProjects = ['api']): Task {
    const meta = { id: 'e1', at: Timestamp.parse(START), author };
    const task = Task.create(
      { id: TaskId.parse('T-1'), title: 'v1', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: ProjectId.parse(taskProjects[0] as string) },
      meta,
    );
    for (const other of taskProjects.slice(1)) {
      task.attach(ProjectId.parse(other), { ...meta, id: `e-${other}` });
    }
    if (groups.length > 0) {
      const estimate = Estimate.of({
        parts: groups.map((p, i) =>
          EstimatePart.of({
            id: `p${i}`,
            name: `part ${i}`,
            ...(p.group === undefined ? {} : { group: p.group }),
            hours: ThreePointEstimate.of({ optimistic: p.likely, likely: p.likely, pessimistic: p.likely }),
          }),
        ),
      });
      task.saveEstimate(estimate, undefined, { ...meta, id: 'e2' });
    }
    task.start(ProjectId.parse(taskProjects[0] as string), { ...meta, id: 'e3' }, Timestamp.parse(START));
    return task;
  }

  it('counts the plan over all projects of the task, not the current directory', () => {
    project('web', '/work/web');
    project('other', '/work/other');
    archive('/work/api', 'auth', '2026-10-28');
    change('/work/web', 'billing', '- [x] 1\n- [ ] 2\n');
    change('/work/other', 'search', '- [x] 1\n');
    const progress = new TaskPlanProgress(plans, journal).of(
      startedTask([{ group: 'auth', likely: 4 }, { group: 'billing', likely: 4 }, { group: 'search', likely: 2 }], ['api', 'web']),
    );
    expect(progress.plan).toMatchObject({ done: 60, mode: 'changes', notStarted: ['search'], possibleTypos: [] });
  });

  it('names the projects left out of a plan that is counted', () => {
    archive('/work/api', 'auth', '2026-10-28');
    const progress = new TaskPlanProgress(plans, journal).of(
      startedTask([{ group: 'auth', likely: 4 }, { group: 'billing', likely: 4 }], ['api', 'web']),
    );
    expect(progress).toMatchObject({ plan: { done: 50 }, untracked: [{ project: 'web', reason: 'not-on-this-machine' }] });
    expect(progress.unavailable).toBeUndefined();
  });

  it('names why the plan is not counted', () => {
    project('plain', '/work/plain', 'none');
    const reader = new TaskPlanProgress(plans, journal);
    expect(reader.of(startedTask([], ['plain']))).toEqual({
      unavailable: 'flow-none',
      untracked: [{ project: 'plain', reason: 'flow-none', flow: 'none' }],
      completed: [],
    });
    project('bare', '/work/bare', null);
    expect(reader.of(startedTask([], ['bare'])).unavailable).toBe('no-config');
    expect(reader.of(startedTask([{ group: 'x', likely: 2 }], ['plain']))).toMatchObject({ unavailable: 'flow-none', completed: [] });
    files.write('/work/bare/.estimetry/config.yaml', 'flow: opnspec\n');
    expect(reader.of(startedTask([], ['bare'])).untracked).toEqual([{ project: 'bare', reason: 'unknown-flow', flow: 'opnspec' }]);
  });

  it('keeps a completion only while its directory is archived and not overridden, first record per directory', () => {
    const task = startedTask([{ group: 'payments', likely: 2 }]);
    const summaryOf = summary('T-1', ['payments']);
    completions.check(summaryOf, NOW);
    change('/work/api', 'payments');
    archive('/work/api', 'payments', '2026-11-01');
    completions.check(summaryOf, NOW);
    state.saved.clear();
    journal.appendRecord(journal.readRecords(TaskId.parse('T-1'))[1] as ProgressRecord); // a duplicate from a race
    const reader = new TaskPlanProgress(plans, journal);
    expect(reader.of(task).completed).toHaveLength(1);
    expect(reader.of(task).plan?.done).toBe(100);

    unarchive('/work/api', 'payments', '2026-11-01');
    expect(reader.of(task).completed).toEqual([]);
    expect(reader.of(task).plan?.done).toBe(0);
  });
});
