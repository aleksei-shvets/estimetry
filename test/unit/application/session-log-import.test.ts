import { ProjectId } from '../../../src/domain/project/project-id.js';
import { EventMetaSource } from '../../../src/application/shared/event-meta-source.js';
import { describe, expect, it } from 'vitest';
import type { LogTurnData, SessionLogRead } from '../../../src/application/contracts/session-logs.js';
import { ImportSessionLogs, MAX_RECORD_BYTES } from '../../../src/application/task/import-session-logs.js';
import type { LogSession } from '../../../src/domain/progress/session-log.js';
import { sessionLogs } from '../../../src/domain/progress/session-log.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { SessionLogReaderRegistry } from '../../../src/integrations/tools/session-log-readers.js';
import { at } from '../../support/activity.js';
import { FakeSessionLogs, InMemoryLogImportState } from '../../support/closing-fakes.js';
import { FakeAuthorProvider, FixedClock, RecordingErrorReporter, SequentialIdGenerator } from '../../support/fakes.js';
import { InMemoryEventJournal } from '../../support/in-memory-repositories.js';
import { SessionId } from '../../../src/domain/measurement/session-id.js';

const ms = (time: string) => at(time).toMillis();

function setup() {
  const logs = new FakeSessionLogs();
  const state = new InMemoryLogImportState();
  const journal = new InMemoryEventJournal();
  const errors = new RecordingErrorReporter();
  const importer = new ImportSessionLogs({
    readers: new SessionLogReaderRegistry().register(logs),
    state,
    journal,
    meta: new EventMetaSource(new FixedClock('2026-10-27T12:00:00.000Z'), new SequentialIdGenerator(), new FakeAuthorProvider()),
    errors,
  });
  const records = (task = 'T-1') => journal.readRecords(TaskId.parse(task)).filter((r): r is LogSession => r.type === 'log.session');
  const run = (tasks = ['T-1'], session = 's1') =>
    importer
      .execute({ session: SessionId.parse(session), source: 'claude-code', tasks: tasks.map((id) => ({ id: TaskId.parse(id), project: ProjectId.parse('api') })) })
      .map((r) => `${r.task.toString()} ${r.outcome}`);
  return { logs, state, journal, errors, importer, records, run };
}

const turn = (key: number, start: string, end: string, output = 0): LogTurnData => ({
  key,
  start: ms(start),
  end: ms(end),
  tokens: output === 0 ? [] : [{ at: ms(start), model: 'm', input: 0, output, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }],
});

function read(turns: LogTurnData[], size: number, next = turns.at(-1)?.key ?? 0): SessionLogRead {
  return { status: 'read', from: 0, next, turns, agents: [], cost: [{ startTime: 1, totalUSD: 2, unknown: false }], skipped: 0, fingerprint: { main: { size, mtimeMs: size }, agents: {} } };
}

describe('importing a session log', () => {
  it('writes the log once; an unchanged log writes nothing', () => {
    const { logs, records, run } = setup();
    logs.logs.set('s1', read([turn(0, '10:00', '10:05'), turn(100, '10:10', '10:12')], 200));
    expect(run()).toEqual(['T-1 imported']);
    expect(run()).toEqual(['T-1 no-new-data']);
    expect(records()).toHaveLength(1);
    expect(records()[0]?.data).toMatchObject({ session: 's1', source: 'claude-code-log', from: 0, part: 1, parts: 1 });
  });

  it('reads on from the last turn of the previous import, and the later record wins', () => {
    const { logs, records, run } = setup();
    logs.logs.set('s1', read([turn(0, '10:00', '10:05'), turn(100, '10:10', '10:12')], 200));
    run();
    logs.logs.set('s1', read([turn(0, '10:00', '10:05'), turn(100, '10:10', '10:19'), turn(300, '11:00', '11:01')], 400));
    run();
    expect(logs.requests.map((request) => request.from)).toEqual([0, 100]);
    expect(records()[1]?.data.from).toBe(100);
    const merged = sessionLogs(records()).get('s1');
    expect(merged?.turns.map((t) => t.end)).toEqual([ms('10:05'), ms('10:19'), ms('11:01')]);
  });

  it('cost totals written on exit after the import of the session end come in with the next import', () => {
    const { logs, records, run } = setup();
    logs.logs.set('s1', read([turn(0, '10:00', '10:05')], 200));
    run();
    logs.logs.set('s1', { ...read([turn(0, '10:00', '10:05')], 260), cost: [{ startTime: 1, totalUSD: 3.5, unknown: false }] });
    expect(run()).toEqual(['T-1 imported']);
    expect([...(sessionLogs(records()).get('s1')?.cost.values() ?? [])].map((c) => c.totalUSD)).toEqual([3.5]);
  });

  it('a lost import cache reads the log from the start, and the merged log stays the same', () => {
    const { logs, records, run, state } = setup();
    logs.logs.set('s1', read([turn(0, '10:00', '10:05', 7), turn(100, '10:10', '10:12', 9)], 200));
    run();
    const before = sessionLogs(records()).get('s1');
    state.entries.delete('s1');
    expect(run()).toEqual(['T-1 imported']);
    expect(logs.requests.map((request) => request.from)).toEqual([0, 0]);
    expect(records()).toHaveLength(2);
    expect(sessionLogs(records()).get('s1')).toEqual(before);
  });

  it('reads once for two tasks, from the earliest offset, and gives each what is new to it', () => {
    const { logs, records, run, state } = setup();
    logs.logs.set('s1', read([turn(0, '10:00', '10:05'), turn(100, '10:10', '10:12')], 200));
    run(['T-1']);
    logs.logs.set('s1', read([turn(0, '10:00', '10:05'), turn(100, '10:10', '10:12'), turn(300, '11:00', '11:01')], 400));
    expect(run(['T-1', 'T-2'])).toEqual(['T-1 imported', 'T-2 imported']);
    expect(logs.requests.map((request) => request.from)).toEqual([0, 0]);
    expect(records('T-1')[1]?.data.turns.map((t) => t.key)).toEqual([100, 300]);
    expect(records('T-2')[0]?.data.turns.map((t) => t.key)).toEqual([0, 100, 300]);
    expect(Object.keys(state.read(SessionId.parse('s1')))).toEqual(['T-1', 'T-2']);
  });

  it('splits a large import into parts of one import id, each under the limit', () => {
    const { logs, records, run } = setup();
    const many = Array.from({ length: 3000 }, (_, i) => turn(i * 10, '10:00', '10:01', i + 1));
    logs.logs.set('s1', read(many, 99));
    run();
    const parts = records();
    expect(parts.length).toBeGreaterThan(1);
    expect(new Set(parts.map((p) => p.data.importId)).size).toBe(1);
    expect(parts.every((p) => JSON.stringify(p).length <= MAX_RECORD_BYTES)).toBe(true);
    expect(sessionLogs(parts).get('s1')?.turns).toHaveLength(3000);
  });

  it('a turn too large for one record goes in pieces that the reading joins again', () => {
    const { logs, records, run } = setup();
    const tokens = Array.from({ length: 2000 }, (_, i) => ({ at: ms('10:00') + i * 300_000, model: 'm', input: 1, output: 1, cacheRead: 1, cacheWrite5m: 1, cacheWrite1h: 1 }));
    logs.logs.set('s1', read([{ key: 0, start: ms('10:00'), end: ms('20:00'), tokens }], 7));
    expect(run()).toEqual(['T-1 imported']);
    expect(records().length).toBeGreaterThan(1);
    expect(records().every((p) => JSON.stringify(p).length <= MAX_RECORD_BYTES)).toBe(true);
    const merged = sessionLogs(records()).get('s1');
    expect(merged?.turns).toHaveLength(1);
    expect(merged?.turns[0]).toMatchObject({ start: ms('10:00'), end: ms('20:00') });
    expect(merged?.turns[0]?.tokens).toHaveLength(2000);
  });

  it('a session id that could name a file outside the store never reaches the import: it is no SessionId', () => {
    expect(() => SessionId.parse('../x')).toThrow();
  });

  it('a missing log, an empty one and one over the budget write nothing; failures leave a code only', () => {
    const { logs, records, run, errors } = setup();
    expect(run()).toEqual(['T-1 not-found']);
    logs.statuses.set('s1', { status: 'no-data', fingerprint: { main: { size: 0, mtimeMs: 1 }, agents: {} } });
    expect(run()).toEqual(['T-1 no-data']);
    expect(run()).toEqual(['T-1 no-new-data']);
    expect(errors.reports).toHaveLength(0);
    logs.statuses.set('s2', { status: 'over-budget' });
    expect(run(['T-1'], 's2')).toEqual(['T-1 over-budget']);
    expect(records()).toHaveLength(0);
    expect(errors.reports.map((report) => String((report.error as Error).message))).toEqual(['session log: log-import-budget']);
  });

  it('a log the reader throws on is a failure with a code, never its message', () => {
    const { logs, run, errors } = setup();
    logs.read = () => {
      throw new Error('/home/user/secret-project: Unexpected token in "prompt text"');
    };
    logs.logs.set('s1', read([turn(0, '10:00', '10:05')], 10));
    expect(run()).toEqual(['T-1 failed']);
    expect(String((errors.reports[0]?.error as Error).message)).toBe('session log: log-import-failed');
  });
});
