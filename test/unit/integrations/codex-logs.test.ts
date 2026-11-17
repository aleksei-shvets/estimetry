import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionLogRead, SessionLogResult } from '../../../src/application/contracts/session-logs.js';
import { SessionId } from '../../../src/domain/measurement/session-id.js';
import { CodexLogs } from '../../../src/integrations/tools/codex/importer/codex-logs.js';
import { SECRET, rollout as r, rolloutText, writeRollout } from '../../support/codex-log.js';
import { tempDir } from '../../support/temp-dir.js';

const SESSION = '01a162ca-f1f0-7da1-9125-c703441d95a4';
const CHILD = '01a12ed5-34e7-7222-a8d4-5f6d640b20ea';
const ms = (time: string) => Date.parse(`2026-11-17T${time}.000Z`);

let home: string;
let logs: CodexLogs;
const read = (from = 0, path?: string): SessionLogResult =>
  logs.read({ session: SessionId.parse(SESSION), from, ...(path === undefined ? {} : { path }) });
const ok = (result: SessionLogResult): SessionLogRead => {
  if (result.status !== 'read') {
    throw new Error(`expected a read, got ${result.status}`);
  }
  return result;
};

beforeEach(() => {
  home = tempDir('codex-');
  logs = new CodexLogs(home);
});

describe('reading a rollout of Codex', () => {
  it('turns from task_started to task_complete or turn_aborted, keyed by their lines', () => {
    const path = writeRollout(home, SESSION, [
      r.meta(SESSION, '09:59:59'),
      r.started('10:00:00', 't1'),
      r.turnContext('10:00:00', 't1', 'gpt-x'),
      r.message('10:07:00'),
      r.complete('10:08:00', 't1'),
      r.started('11:00:00', 't2'),
      r.aborted('11:04:00', 't2'),
    ]);
    const result = ok(read(0, path));
    expect(result.turns.map((t) => [t.start, t.end])).toEqual([
      [ms('10:00:00'), ms('10:08:00')],
      [ms('11:00:00'), ms('11:04:00')],
    ]);
    expect(result.next).toBe(result.turns[1]?.key);
    expect(result).not.toHaveProperty('cost');
    expect(result.skipped).toBe(0);
  });

  it('counts the cached input once, by the model of the last turn context, once per response', () => {
    const path = writeRollout(home, SESSION, [
      r.meta(SESSION, '09:59:59'),
      r.started('10:00:00', 't1'),
      r.turnContext('10:00:00', 't1', 'gpt-x'),
      r.usage('10:01:00', 'resp-1', { input: 23_222, cached: 23_040, output: 55, cacheWrite: 7 }),
      r.tokenCount('10:01:00', { input: 23_222, cached: 23_040, output: 55 }),
      r.usage('10:01:00', 'resp-1', { input: 23_222, cached: 23_040, output: 55 }),
      r.turnContext('10:02:00', 't1', 'gpt-y'),
      r.usage('10:02:00', 'resp-2', { input: 100, output: 10 }),
      r.complete('10:03:00', 't1'),
    ]);
    const tokens = ok(read(0, path)).turns.flatMap((t) => t.tokens);
    expect(tokens.find((b) => b.model === 'gpt-x')).toMatchObject({ input: 182, cacheRead: 23_040, output: 55, cacheWrite: 7, cacheWrite5m: 0, cacheWrite1h: 0 });
    expect(tokens.find((b) => b.model === 'gpt-y')).toMatchObject({ input: 100, output: 10 });
  });

  it('takes token_count when the rollout has no token_usage_record', () => {
    const path = writeRollout(home, SESSION, [
      r.meta(SESSION, '09:59:59'),
      r.started('10:00:00', 't1'),
      r.turnContext('10:00:00', 't1', 'gpt-x'),
      r.tokenCount('10:01:00', { input: 1_000, cached: 400, output: 20 }),
      r.complete('10:02:00', 't1'),
    ]);
    expect(ok(read(0, path)).turns[0]?.tokens).toEqual([
      { at: ms('10:00:00'), model: 'gpt-x', input: 600, output: 20, cacheRead: 400, cacheWrite5m: 0, cacheWrite1h: 0, cacheWrite: 0 },
    ]);
  });

  it('reads on from an offset: the last turn again, and what came after it', () => {
    const lines = [r.meta(SESSION, '09:59:59'), r.started('10:00:00', 't1'), r.complete('10:05:00', 't1'), r.started('10:10:00', 't2')];
    const path = writeRollout(home, SESSION, lines);
    const first = ok(read(0, path));
    appendFileSync(path, rolloutText([r.complete('10:20:00', 't2')]));
    const second = ok(read(first.next, path));
    expect(second.from).toBe(first.next);
    expect(second.turns.map((t) => [t.start, t.end])).toEqual([[ms('10:10:00'), ms('10:20:00')]]);
  });

  it('reads the subagents the agent spawned, found by their own meta, as spans and tokens; not internal ones', () => {
    const path = writeRollout(home, SESSION, [
      r.meta(SESSION, '09:59:59'),
      r.started('10:00:00', 't1'),
      r.complete('10:30:00', 't1'),
    ]);
    // A review of Codex itself, and a subagent of another session: neither is work of this session's agent.
    writeRollout(home, '01a1eaaa-0000-7000-8000-00000000guar', [
      { timestamp: '2026-11-17T10:11:00.000Z', type: 'session_meta', payload: { id: 'guardian-1', session_id: SESSION, source: { subagent: { other: 'guardian' } } } },
    ]);
    writeRollout(home, '01a1eaaa-0000-7000-8000-00000000othr', [r.meta('other-child', '10:12:00', 'other-session')]);
    // The child of a session resumed the next day.
    writeRollout(home, 'next-day-child', [r.meta('next-day-child', '09:00:00', SESSION), r.started('09:00:00', 'n1'), r.complete('09:05:00', 'n1')], ['2026', '11', '18']);
    writeRollout(home, CHILD, [
      r.meta(CHILD, '10:10:00', SESSION),
      r.started('10:10:00', 'c1'),
      r.turnContext('10:10:00', 'c1', 'gpt-mini'),
      r.usage('10:12:00', 'resp-c', { input: 50, output: 5 }),
      r.complete('10:20:00', 'c1'),
    ]);
    const result = ok(read(0, path));
    expect(result.agents.map((a) => a.agent)).toEqual([CHILD, 'next-day-child']);
    expect(result.agents.slice(0, 1)).toEqual([
      {
        agent: CHILD,
        spans: [[ms('10:10:00'), ms('10:20:00')]],
        tokens: [{ at: ms('10:10:00'), model: 'gpt-mini', input: 50, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWrite: 0 }],
      },
    ]);
    expect(result.fingerprint.agents).toEqual({});
  });

  it('finds the rollout of a session without a path in the day directories', () => {
    writeRollout(home, SESSION, [r.meta(SESSION, '09:59:59'), r.started('10:00:00', 't1'), r.complete('10:05:00', 't1')], ['2026', '11', '16']);
    mkdirSync(join(home, 'sessions', '2026', '11', '17'), { recursive: true });
    expect(ok(read()).turns).toHaveLength(1);
    expect(logs.fingerprint(SessionId.parse(SESSION))).toBeDefined();
  });

  it('no rollout, an empty one, another format, a compressed one', () => {
    expect(read()).toEqual({ status: 'not-found' });
    const empty = writeRollout(home, SESSION, []);
    writeFileSync(empty, '');
    expect(read(0, empty)).toMatchObject({ status: 'no-data' });
    const other = writeRollout(home, SESSION, [{ type: 'user', timestamp: '2026-11-17T10:00:00.000Z', message: SECRET }]);
    expect(read(0, other)).toMatchObject({ status: 'unrecognized' });
    const zst = join(home, 'sessions', '2026', '11', '17', `rollout-2026-11-17T10-00-00-${SESSION}.jsonl.zst`);
    writeFileSync(zst, 'compressed');
    expect(read(0, zst).status).not.toBe('read');
  });

  it('stops past its budget', () => {
    const lines = [r.meta(SESSION, '09:59:59'), ...Array.from({ length: 20_000 }, (_, i) => r.message(`10:${String(Math.floor(i / 1000) % 60).padStart(2, '0')}:00`))];
    const path = writeRollout(home, SESSION, lines);
    expect(logs.read({ session: SessionId.parse(SESSION), path, from: 0, budgetMs: 0 })).toEqual({ status: 'over-budget' });
  });

  it('keeps no text of the rollout', () => {
    const path = writeRollout(home, SESSION, [
      r.meta(SESSION, '09:59:59'),
      r.started('10:00:00', 't1'),
      r.message('10:01:00'),
      r.subagent('10:02:00', CHILD, 'started'),
      r.complete('10:03:00', 't1'),
      '{ not json',
    ]);
    const result = ok(read(0, path));
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.skipped).toBe(1);
  });
});
