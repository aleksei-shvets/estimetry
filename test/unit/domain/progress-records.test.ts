import { describe, expect, it } from 'vitest';
import { InvalidProgressRecord, parseProgressRecord } from '../../../src/domain/progress/progress-record-parser.js';
import { fileList, MAX_RECORDED_FILES } from '../../../src/domain/progress/progress-records.js';

const envelope = { schemaVersion: 1, id: 'r-1', ts: '2026-10-30T10:00:00.000Z', author: 'dev@example.com', task: 'T-1', project: 'api' };
const checkpoint = {
  ...envelope,
  type: 'checkpoint.recorded',
  data: {
    source: 'estimetry',
    session: 's1',
    plan: [{ change: 'a', archived: false, done: 3, total: 10 }],
    head: '9f2c',
    workingTree: { files: [{ path: 'src/x.ts', added: 12, deleted: 3 }, { path: 'logo.png', added: null, deleted: null }], fileCount: 2, truncated: false, untracked: 1 },
  },
};
const commit = {
  ...envelope,
  type: 'commit.recorded',
  data: {
    source: 'git',
    sha: 'abc',
    parents: ['def'],
    patchId: '123',
    authoredAt: '2026-10-30T09:59:00.000Z',
    committedAt: '2026-10-30T10:00:00.000Z',
    files: [{ path: 'src/a.ts', added: 10, deleted: 2 }],
    fileCount: 1,
    truncated: false,
  },
};

describe('progress records', () => {
  it('accepts checkpoints and commits, also without optional parts and without a task', () => {
    expect(parseProgressRecord(checkpoint).type).toBe('checkpoint.recorded');
    expect(parseProgressRecord(commit).type).toBe('commit.recorded');
    expect(parseProgressRecord({ ...checkpoint, data: { source: 'estimetry', session: 's1' } }).type).toBe('checkpoint.recorded');
    const { task: _task, ...withoutTask } = commit;
    expect(parseProgressRecord(withoutTask, { withoutTask: true }).type).toBe('commit.recorded');
  });

  it.each([
    [{ ...checkpoint, data: { ...checkpoint.data, plan: [{ change: 'a', archived: 'no', done: 1, total: 1 }] } }, 'data.plan[0].archived'],
    [{ ...checkpoint, data: { ...checkpoint.data, workingTree: { ...checkpoint.data.workingTree, untracked: -1 } } }, 'data.workingTree.untracked'],
    [{ ...commit, data: { ...commit.data, files: [{ path: 'a', added: 1.5, deleted: 0 }] } }, 'data.files[0].added'],
    [{ ...commit, data: { ...commit.data, sha: '' } }, 'data.sha'],
    [{ ...commit, type: 'commit.made' }, 'type'],
  ])('rejects a broken record and names the field (%#)', (record, path) => {
    try {
      parseProgressRecord(record);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidProgressRecord);
      expect((error as InvalidProgressRecord).path).toBe(path);
    }
  });

  it('accepts completions and baselines, and an archive date in a checkpoint plan', () => {
    const completed = {
      ...envelope,
      type: 'change.completed',
      data: { source: 'estimetry', project: 'api', change: 'auth', directory: '2026-10-30-auth', flow: 'openspec', completedAt: '2026-10-30T10:00:00.000Z', detectedAt: '2026-10-30T10:00:05.000Z', approximate: false },
    };
    expect(parseProgressRecord(completed).type).toBe('change.completed');
    expect(parseProgressRecord({ ...envelope, type: 'plan.baseline', data: { source: 'estimetry', project: 'api', directories: ['2026-09-01-old'] } }).type).toBe('plan.baseline');
    expect(() => parseProgressRecord({ ...completed, data: { ...completed.data, approximate: 'no' } })).toThrow(/data.approximate/);
    const dated = { ...checkpoint, data: { ...checkpoint.data, plan: [{ change: 'a', archived: true, archivedOn: '2026-10-30', done: 1, total: 1 }] } };
    expect(parseProgressRecord(dated).type).toBe('checkpoint.recorded');
    expect(() => parseProgressRecord({ ...dated, data: { ...dated.data, plan: [{ change: 'a', archived: true, archivedOn: '2026-13-01', done: 1, total: 1 }] } })).toThrow(/archivedOn/);
  });

  it('cuts long file lists and keeps the real count', () => {
    const many = Array.from({ length: MAX_RECORDED_FILES + 5 }, (_, i) => ({ path: `f${i}`, added: 1, deleted: 0 }));
    expect(fileList(many)).toMatchObject({ fileCount: MAX_RECORDED_FILES + 5, truncated: true });
    expect(fileList(many).files).toHaveLength(MAX_RECORDED_FILES);
    expect(fileList(many.slice(0, 3))).toMatchObject({ fileCount: 3, truncated: false });
  });
});
