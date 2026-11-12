import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionImportRequest, SessionImport } from '../../../src/application/task/import-session-logs.js';
import { CardBuilder } from '../../../src/application/task/card-builder.js';
import { ClosingFollowUp } from '../../../src/application/task/closing-follow-up.js';
import { ClosingRecords } from '../../../src/application/task/closing-records.js';
import { CodeVolumeService } from '../../../src/application/task/code-volume-service.js';
import { PlanSnapshots } from '../../../src/application/task/plan-snapshots.js';
import { RevisionRecords } from '../../../src/application/task/revision-records.js';
import { TaskMeasurement } from '../../../src/application/task/task-measurement.js';
import { EventMetaSource } from '../../../src/application/shared/event-meta-source.js';
import { CORE_SOURCE } from '../../../src/application/shared/journal-entry.js';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';
import { activity } from '../../support/activity.js';
import { FakeCodeMeasurer, InMemoryCloseProposals } from '../../support/closing-fakes.js';
import { FakeAuthorProvider, FixedClock, FixedMeasurementSettings, SequentialIdGenerator } from '../../support/fakes.js';
import { FakeProjectPlans, InMemorySessionBindings } from '../../support/hook-fakes.js';
import { InMemoryEventJournal, InMemoryProjectRepository, InMemoryTaskRepository } from '../../support/in-memory-repositories.js';

const time = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
const api = ProjectId.parse('api');
const web = ProjectId.parse('web');
let n = 0;
const at = (hhmm: string) => ({ id: `m-${++n}`, at: time(hhmm), author: Author.of('dev@example.com') });

/** T-1 of `api` and `web`, started at 09:00, closed at 12:00 unless `open`. */
function task(open = false): Task {
  const t = Task.create({ id: TaskId.parse('T-1'), title: 'Webhook', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, at('08:00'));
  t.start(api, at('09:00'));
  t.attach(web, at('09:10'));
  if (!open) {
    t.close({ at: time('12:00'), outcome: 'completed' }, at('12:30'));
  }
  return t;
}

let journal: InMemoryEventJournal;
let bindings: InMemorySessionBindings;
let proposals: InMemoryCloseProposals;
let meta: EventMetaSource;

beforeEach(() => {
  journal = new InMemoryEventJournal();
  bindings = new InMemorySessionBindings();
  proposals = new InMemoryCloseProposals();
  meta = new EventMetaSource(new FixedClock('2026-10-27T13:00:00.000Z'), new SequentialIdGenerator(), new FakeAuthorProvider());
});

describe('the steps after the closing', () => {
  const cards = (fail: 'refresh' | 'recalculate' | undefined, calls: string[]) => ({
    refresh: () => {
      calls.push('refresh');
      if (fail === 'refresh') throw new Error('disk full');
      return undefined;
    },
    recalculate: () => {
      calls.push('recalculate');
      if (fail === 'recalculate') throw new Error('locked');
      return { schemaVersion: 2, minTasks: 5, authors: {} };
    },
  });

  it('lets go of the sessions bound to the task in each of its projects, at the closing moment', () => {
    bindings.setPlain({ session: 's1', project: 'api', root: '/work/api', task: 'T-1', since: time('09:00').toISOString() });
    bindings.setPlain({ session: 's2', project: 'web', root: '/work/web', task: 'T-1' });
    bindings.setPlain({ session: 's3', project: 'api', root: '/work/api', task: 'T-9' });
    const calls: string[] = [];
    const warnings = new ClosingFollowUp(journal, bindings, proposals, cards(undefined, calls), meta).finish(task());
    expect(warnings).toEqual([]);
    expect(bindings.plain('s1')).toMatchObject({ session: 's1', project: 'api', root: '/work/api', everBound: true, closedTask: 'T-1' });
    expect(bindings.plain('s1')?.task).toBeUndefined();
    expect(bindings.plain('s2')).toMatchObject({ everBound: true, closedTask: 'T-1' });
    expect(bindings.plain('s3')?.task).toBe('T-9');
    const unbound = journal.readActivity(TaskId.parse('T-1'));
    expect(unbound.map((e) => [e.type, e.ts, e.project, e.data.session, e.data.source])).toEqual([
      ['session.unbound', time('12:00').toISOString(), 'api', 's1', CORE_SOURCE],
      ['session.unbound', time('12:00').toISOString(), 'web', 's2', CORE_SOURCE],
    ]);
    expect(calls).toEqual(['refresh', 'recalculate']);
  });

  it('writes nothing for a session another task took meanwhile', () => {
    bindings.setPlain({ session: 's1', project: 'api', root: '/work/api', task: 'T-1' });
    const racing = {
      ofProject: (project: ProjectId) => bindings.ofProject(project),
      update: bindings.update.bind(bindings),
    };
    // Between the listing and the update another hook binds the session to T-2.
    racing.ofProject = (project: ProjectId) => {
      const listed = bindings.ofProject(project);
      bindings.setPlain({ session: 's1', project: 'api', root: '/work/api', task: 'T-2' });
      return listed;
    };
    new ClosingFollowUp(journal, racing, proposals, cards(undefined, []), meta).finish(task());
    expect(bindings.plain('s1')?.task).toBe('T-2');
    expect(journal.readActivity(TaskId.parse('T-1'))).toEqual([]);
  });

  it('a failing step is a warning, and the steps after it still run', () => {
    proposals.putPlain('T-1', { change: 'a', completedAt: time('11:00').toISOString(), session: 's1' });
    const calls: string[] = [];
    const warnings = new ClosingFollowUp(journal, bindings, proposals, cards('refresh', calls), meta).finish(task());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/writing the card/);
    expect(calls).toEqual(['refresh', 'recalculate']);
    expect(proposals.peek(TaskId.parse('T-1'))).toBeUndefined();
  });
});

describe('the records before the closing', () => {
  function records(outcomes: Record<string, SessionImport['outcome']> = {}, withLogs = true) {
    const plans = new FakeProjectPlans();
    const git = new FakeCodeMeasurer();
    const requests: SessionImportRequest[] = [];
    const importer = {
      execute: (request: SessionImportRequest): SessionImport[] => {
        requests.push(request);
        return [{ session: request.session, task: TaskId.parse('T-1'), outcome: outcomes[request.session.value] ?? 'imported' }];
      },
    };
    const closing = new ClosingRecords(
      journal,
      new CodeVolumeService(plans, git),
      new PlanSnapshots(plans, git, new InMemoryProjectRepository()),
      bindings,
      meta,
      withLogs ? () => importer : undefined,
    );
    // Requests in plain values, for comparing.
    const plain = () =>
      requests.map((r) => ({ ...r, session: r.session.value, tasks: r.tasks.map((t) => ({ id: t.id.toString(), project: t.project.value })) }));
    return { closing, requests, plain };
  }

  it('imports the log of every session of the task once, by its source, with the path the binding knows', () => {
    for (const event of [
      activity('turn.started', '09:30', { origin: 'user', session: 's1', source: 'claude-code' }),
      activity('turn.ended', '09:40', { session: 's1', source: 'other-tool' }),
      activity('session.bound', '09:00', { session: 's2', source: CORE_SOURCE }),
      activity('turn.started', '10:00', { origin: 'user', session: 's2', source: 'claude-code' }),
    ]) {
      journal.append(event);
    }
    bindings.setPlain({ session: 's2', project: 'api', root: '/work/api', transcript: '/logs/s2.jsonl' });
    const { closing, plain } = records({ s1: 'failed', s2: 'unrecognized' });
    const warnings = closing.prepare(task(true), time('12:00'));
    expect(plain()).toEqual([
      { session: 's1', source: 'claude-code', at: time('12:00'), tasks: [{ id: 'T-1', project: 'api' }] },
      { session: 's2', source: 'claude-code', at: time('12:00'), path: '/logs/s2.jsonl', tasks: [{ id: 'T-1', project: 'api' }] },
    ]);
    expect(warnings).toEqual([
      'the log of session s1 was not imported (failed); the fact goes without it',
      'the log of session s2 was not imported (unrecognized); the fact goes without it',
    ]);
  });

  it('skips a session whose id could name a file, and writes the code volume and the plan after the logs', () => {
    journal.append(activity('turn.started', '09:30', { origin: 'user', session: '../etc', source: 'claude-code' }));
    const { closing, requests } = records();
    expect(closing.prepare(task(true), time('12:00'))).toEqual([]);
    expect(requests).toEqual([]);
    const written = journal.readRecords(TaskId.parse('T-1'));
    expect(written.map((record) => [record.type, record.ts])).toEqual([
      ['code.measured', '2026-10-27T13:00:00.000Z'],
      ['plan.closing', '2026-10-27T13:00:00.000Z'],
    ]);
  });

  it('without an importer writes only the code volume and the plan', () => {
    journal.append(activity('turn.started', '09:30', { origin: 'user', session: 's1', source: 'claude-code' }));
    const { closing, requests } = records({}, false);
    expect(closing.prepare(task(true), time('12:00'))).toEqual([]);
    expect(requests).toEqual([]);
    expect(journal.readRecords(TaskId.parse('T-1')).map((record) => record.type)).toEqual(['code.measured', 'plan.closing']);
  });
});

describe('the records of a revision', () => {
  function revisions() {
    const plans = new FakeProjectPlans();
    return new RevisionRecords(journal, new PlanSnapshots(plans, new FakeCodeMeasurer(), new InMemoryProjectRepository()), proposals, meta);
  }

  it('writes the plan snapshot of a revision, which then has its plan', () => {
    const records = revisions();
    const t = task(true);
    expect(records.withPlan(t)).toEqual(new Set());
    records.planRevised(t, 'rev-1', {});
    records.planRevised(t, 'rev-2', {});
    expect(records.withPlan(t)).toEqual(new Set(['rev-1', 'rev-2']));
    expect(journal.readRecords(t.id).map((record) => [record.type, record.project])).toEqual([
      ['plan.revised', 'api'],
      ['plan.revised', 'api'],
    ]);
  });

  it('drops a proposal to close about a change the revision threw away, and only that one', () => {
    const records = revisions();
    const t = task(true);
    const excluded = [{ project: 'api', archives: [{ change: 'a', archivedOn: '2026-10-27' }] }];
    proposals.putPlain('T-1', { change: 'b', project: 'api', completedAt: time('11:00').toISOString(), session: 's1' });
    records.dropProposal(t, excluded);
    expect(proposals.peek(TaskId.parse('T-1'))?.change).toBe('b');
    proposals.putPlain('T-1', { change: 'a', project: 'web', completedAt: time('11:00').toISOString(), session: 's1' });
    records.dropProposal(t, excluded);
    expect(proposals.peek(TaskId.parse('T-1'))?.change).toBe('a');
    proposals.putPlain('T-1', { change: 'a', completedAt: time('11:00').toISOString(), session: 's1' });
    records.dropProposal(t, excluded);
    expect(proposals.peek(TaskId.parse('T-1'))).toBeUndefined();
    records.dropProposal(t, excluded);
    expect(proposals.peek(TaskId.parse('T-1'))).toBeUndefined();
  });
});

describe('the card of a closed task from its journal', () => {
  it('is built again by id only for a task that is here and closed', () => {
    const tasks = new InMemoryTaskRepository();
    const measurement = new TaskMeasurement(journal, new FixedMeasurementSettings(), new FixedClock('2026-10-27T13:00:00.000Z'));
    const builder = new CardBuilder(journal, measurement, tasks);
    expect(builder.rebuild(TaskId.parse('T-1'))).toBeUndefined();
    const open = task(true);
    tasks.save(open);
    expect(builder.rebuild(TaskId.parse('T-1'))).toBeUndefined();
    const closed = task();
    const fresh = new InMemoryTaskRepository();
    fresh.save(closed);
    const card = new CardBuilder(journal, measurement, fresh).rebuild(TaskId.parse('T-1'));
    expect(card).toEqual(builder.build(closed));
    expect(card?.task.id).toBe('T-1');
    expect(card?.calendarMinutes).toBe(180);
  });
});
