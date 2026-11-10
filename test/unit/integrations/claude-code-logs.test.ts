import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SessionLogRead, SessionLogResult } from '../../../src/application/contracts/session-logs.js';
import { SessionLogFailure } from '../../../src/application/contracts/session-logs.js';
import { ClaudeCodeLogs } from '../../../src/integrations/tools/claude-code/importer/claude-code-logs.js';
import { at } from '../../support/activity.js';
import { log, SECRET, text, writeLog } from '../../support/claude-log.js';
import { tempDir } from '../../support/temp-dir.js';

const ms = (time: string) => at(time).toMillis();

function read(lines: Parameters<typeof writeLog>[1], options: Parameters<typeof writeLog>[2] = {}, from = 0): SessionLogRead {
  const written = writeLog(tempDir(), lines, options);
  const result = new ClaudeCodeLogs(written.configDir).read({ session: options.session ?? 's1', from });
  expect(result.status).toBe('read');
  return result as SessionLogRead;
}

function turns(result: SessionLogRead) {
  return result.turns.filter((turn) => turn.start !== undefined).map((turn) => [turn.start, turn.end]);
}

function noText(result: SessionLogResult): void {
  const dump = JSON.stringify(result);
  expect(dump).not.toContain(SECRET);
  expect(dump).not.toContain('interrupted');
}

describe('reading a Claude Code session log', () => {
  it('a turn runs from the prompt to the end of the answer', () => {
    const result = read([
      log.prompt('10:00:00'),
      log.assistant('10:01:00'),
      log.toolResult('10:07:30'),
      log.assistant('10:08:00', { stop: 'end_turn' }),
    ]);
    expect(turns(result)).toEqual([[ms('10:00:00'), ms('10:08:00')]]);
    noText(result);
  });

  it('a turn continued by a Stop hook ends at its last stop', () => {
    const result = read([log.prompt('10:00'), log.assistant('10:04', { stop: 'end_turn' }), log.stopHook('10:05'), log.assistant('10:08'), log.stopHook('10:09')]);
    expect(turns(result)).toEqual([[ms('10:00'), ms('10:09')]]);
  });

  it('a compaction summary does not start a turn; a notification of a background agent does', () => {
    const result = read([
      log.prompt('10:00'),
      log.prompt('10:20', { compact: true }),
      log.assistant('10:30', { stop: 'end_turn' }),
      log.prompt('11:00', { origin: 'task_notification' }),
      log.assistant('11:04', { stop: 'end_turn' }),
      log.prompt('12:00', { origin: 'peer' }),
      log.assistant('12:01', { stop: 'end_turn' }),
    ]);
    expect(turns(result)).toEqual([
      [ms('10:00'), ms('10:30')],
      [ms('11:00'), ms('11:04')],
      [ms('12:00'), ms('12:01')],
    ]);
  });

  it('an interruption ends the turn; a notification without an origin does not start one', () => {
    const result = read([log.prompt('10:00'), log.assistant('10:06'), log.interruption('10:07'), log.notification('10:15'), log.prompt('10:30'), log.assistant('10:31', { stop: 'end_turn' })]);
    expect(turns(result)).toEqual([
      [ms('10:00'), ms('10:07')],
      [ms('10:30'), ms('10:31')],
    ]);
    noText(result);
  });

  it('records of a resumed session dated before the turn do not move it, but their tokens count', () => {
    const result = read([log.prompt('12:00'), log.assistant('08:00', { usage: { output: 7 } }), log.assistant('12:10', { stop: 'end_turn' })]);
    expect(turns(result)).toEqual([[ms('12:00'), ms('12:10')]]);
    expect(result.turns[0]?.tokens.map((bucket) => bucket.output)).toEqual([7, 0]);
  });

  it('without an end marker the turn ends at its last answer or tool result; synthetic answers do not count', () => {
    const result = read([log.prompt('10:00'), log.assistant('10:05'), log.toolResult('10:06'), log.assistant('10:40', { model: '<synthetic>', stop: 'end_turn' })]);
    expect(turns(result)).toEqual([[ms('10:00'), ms('10:06')]]);
  });

  it('logs of older versions without turnOrigin start a turn with a typed prompt', () => {
    const result = read([log.prompt('10:00', { origin: null }), log.toolResult('10:02'), log.prompt('10:03', { origin: null, meta: true }), log.assistant('10:05', { stop: 'end_turn' })]);
    expect(turns(result)).toEqual([[ms('10:00'), ms('10:05')]]);
  });

  it('counts a message split into several records once, by model and five-minute bucket', () => {
    const usage = { input: 10, output: 500, cacheRead: 1000, write5m: 20, write1h: 30 };
    const result = read([
      log.prompt('10:00'),
      log.assistant('10:01', { id: 'msg1', usage }),
      log.assistant('10:01:01', { id: 'msg1', usage }),
      log.assistant('10:01:02', { id: 'msg1', usage }),
      log.assistant('10:07', { id: 'msg2', usage: { output: 1, write5m: 4, noSplit: true } }),
    ]);
    expect(result.turns[0]?.tokens).toEqual([
      { at: ms('10:00'), model: 'claude-opus-5-5', input: 10, output: 500, cacheRead: 1000, cacheWrite5m: 20, cacheWrite1h: 30 },
      { at: ms('10:05'), model: 'claude-opus-5-5', input: 0, output: 1, cacheRead: 0, cacheWrite5m: 4, cacheWrite1h: 0 },
    ]);
  });

  it('reads subagents by the id of their file: stretches of records and tokens, nothing of meta.json', () => {
    const result = read([log.prompt('10:00'), log.assistant('10:30', { stop: 'end_turn' })], {
      agents: {
        a1: [log.prompt('10:05', { origin: null }), log.assistant('10:05:30', { model: 'claude-haiku-5-5', usage: { output: 9 } }), log.assistant('10:20')],
      },
    });
    expect(result.agents).toEqual([
      {
        agent: 'a1',
        spans: [
          [ms('10:05'), ms('10:05:30')],
          [ms('10:20'), ms('10:20')],
        ],
        tokens: [
          { at: ms('10:05'), model: 'claude-haiku-5-5', input: 0, output: 9, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
          { at: ms('10:20'), model: 'claude-opus-5-5', input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
        ],
      },
    ]);
    noText(result);
  });

  it('skips lines that are not JSON and records of unknown types', () => {
    const lines = [log.prompt('10:00'), ...Array.from({ length: 86 }, (_, i) => log.assistant(`10:${String(10 + (i % 40)).padStart(2, '0')}`)), log.assistant('10:59', { stop: 'end_turn' })];
    const noise = [log.broken(), log.broken(), log.broken(), ...Array.from({ length: 10 }, () => log.service('brand-new-kind', '10:30')), log.service('attachment', '10:30')];
    const result = read([...lines, ...noise]);
    expect(result.skipped).toBe(13);
    noText(result);
  });

  it('keeps the last total of every process', () => {
    const result = read([log.prompt('10:00'), log.cost(1, 4), log.cost(1, 6), log.cost(2, 1, true), log.assistant('10:01', { stop: 'end_turn' })]);
    expect(result.cost).toEqual([
      { startTime: 1, totalUSD: 6, unknown: false },
      { startTime: 2, totalUSD: 1, unknown: true },
    ]);
  });

  it('an empty log is no data; a log of service records only is not recognized', () => {
    const empty = writeLog(tempDir(), []);
    expect(new ClaudeCodeLogs(empty.configDir).read({ session: 's1', from: 0 }).status).toBe('no-data');
    const service = writeLog(tempDir(), [log.service('mode'), log.service('ai-title')]);
    const result = new ClaudeCodeLogs(service.configDir).read({ session: 's1', from: 0 });
    expect(result.status).toBe('unrecognized');
    noText(result);
  });

  it('finds the log by the path the hook reported, else in every project folder; a missing log is not found', () => {
    const written = writeLog(tempDir(), [log.prompt('10:00'), log.assistant('10:01', { stop: 'end_turn' })], { folder: 'elsewhere' });
    expect(new ClaudeCodeLogs(tempDir()).read({ session: 's1', path: written.path, from: 0 }).status).toBe('read');
    expect(new ClaudeCodeLogs(written.configDir).read({ session: 's1', from: 0 }).status).toBe('read');
    expect(new ClaudeCodeLogs(written.configDir).read({ session: 's2', from: 0 }).status).toBe('not-found');
    expect(new ClaudeCodeLogs(written.configDir).fingerprint('s2')).toBeUndefined();
  });

  it('reads on from the first line of the last turn, so a continued turn is read again in full', () => {
    const written = writeLog(tempDir(), [log.prompt('10:00'), log.assistant('10:02', { stop: 'end_turn' }), log.prompt('10:10'), log.assistant('10:12', { stop: 'end_turn' }), log.stopHook('10:13')]);
    const reader = new ClaudeCodeLogs(written.configDir);
    const first = reader.read({ session: 's1', from: 0 }) as SessionLogRead;
    expect(first.next).toBe(first.turns[1]?.key);
    appendFileSync(written.path, text([log.assistant('10:15'), log.stopHook('10:19'), log.prompt('11:00'), log.assistant('11:01', { stop: 'end_turn' })]));
    const second = reader.read({ session: 's1', from: first.next }) as SessionLogRead;
    expect(second.from).toBe(first.next);
    expect(turns(second)).toEqual([
      [ms('10:10'), ms('10:19')],
      [ms('11:00'), ms('11:01')],
    ]);
    expect(second.fingerprint.main.size).toBeGreaterThan(first.fingerprint.main.size);
  });

  it('a record appended with a time before the latest one of the previous read still counts: the delta goes by offset', () => {
    const written = writeLog(tempDir(), [
      log.prompt('10:00'),
      log.assistant('10:05', { id: 'm1', stop: 'end_turn', usage: { output: 1 } }),
      log.prompt('10:10'),
      log.assistant('10:12', { id: 'm2', stop: 'end_turn', usage: { output: 2 } }),
    ]);
    const reader = new ClaudeCodeLogs(written.configDir);
    const first = reader.read({ session: 's1', from: 0 }) as SessionLogRead;
    appendFileSync(written.path, text([log.assistant('10:10', { id: 'm3', usage: { output: 5 } })]));
    const second = reader.read({ session: 's1', from: first.next }) as SessionLogRead;
    const output = second.turns.flatMap((t) => t.tokens).reduce((sum, bucket) => sum + bucket.output, 0);
    expect(output).toBe(7);
  });

  it('leaves a last line without a newline for the next read; an offset past the end reads from the start', () => {
    const written = writeLog(tempDir(), [log.prompt('10:00'), log.assistant('10:02', { stop: 'end_turn' })]);
    appendFileSync(written.path, JSON.stringify(log.prompt('10:30')).slice(0, 40));
    const reader = new ClaudeCodeLogs(written.configDir);
    const result = reader.read({ session: 's1', from: 0 }) as SessionLogRead;
    expect(turns(result)).toEqual([[ms('10:00'), ms('10:02')]]);
    expect(result.skipped).toBe(0);
    expect((reader.read({ session: 's1', from: 10 ** 9 }) as SessionLogRead).from).toBe(0);
  });

  it('stops past its budget', () => {
    const written = writeLog(tempDir(), [log.prompt('10:00'), log.assistant('10:02', { stop: 'end_turn' })]);
    expect(new ClaudeCodeLogs(written.configDir).read({ session: 's1', from: 0, budgetMs: -1 }).status).toBe('over-budget');
  });

  it('a failure carries a code and no path', () => {
    const written = writeLog(tempDir(), [log.prompt('10:00')]);
    const reader = new ClaudeCodeLogs(written.configDir);
    try {
      reader.read({ session: 's1', path: `${written.configDir}/projects`, from: 0 }); // a directory, not a file
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SessionLogFailure);
      expect(String((error as Error).message)).not.toContain(SECRET);
      expect(String((error as Error).message)).not.toContain('/');
    }
  });
});
