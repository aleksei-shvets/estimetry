import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidActivityEvent } from '../../src/domain/measurement/activity-events.js';
import { Duration } from '../../src/domain/measurement/duration.js';
import { Extra } from '../../src/domain/measurement/extra.js';
import { ManualTime } from '../../src/domain/measurement/manual-time.js';
import { ParallelModeChange } from '../../src/domain/measurement/parallel-mode.js';
import { InvalidEstimate } from '../../src/domain/estimate/invalid-estimate.js';
import { ProjectId } from '../../src/domain/project/project-id.js';
import { Author } from '../../src/domain/shared/author.js';
import { InvalidValue } from '../../src/domain/shared/domain-error.js';
import type { EventMeta } from '../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../src/domain/shared/timestamp.js';
import { Task } from '../../src/domain/task/task.js';
import { TaskId } from '../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../src/domain/task/task-type.js';
import { writeYamlAtomic } from '../../src/infrastructure/fs/atomic-yaml.js';
import { StorageLayout } from '../../src/infrastructure/fs/storage-layout.js';
import { FileTaskRepository } from '../../src/infrastructure/persistence/file-task-repository.js';
import { JsonlEventJournal } from '../../src/infrastructure/persistence/jsonl-event-journal.js';
import { YamlConfigStore } from '../../src/infrastructure/persistence/yaml-config-store.js';
import { YamlEstimateReader } from '../../src/infrastructure/persistence/yaml-estimate-reader.js';
import { activity } from '../support/activity.js';
import { tempDir } from '../support/temp-dir.js';

let n = 0;
const meta = (): EventMeta => ({ id: `e-${++n}`, at: Timestamp.parse('2026-10-27T10:00:00.000Z'), author: Author.of('dev@example.com') });
const api = ProjectId.parse('api');

function setup() {
  const layout = new StorageLayout(join(tempDir(), 'home'));
  const repo = new FileTaskRepository(layout);
  const task = Task.create({ id: repo.nextId(), title: 'X', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta());
  task.start(api, meta(), Timestamp.parse('2026-10-27T06:00:00.000Z'));
  repo.save(task);
  return { layout, repo, journal: new JsonlEventJournal(layout) };
}

describe('JsonlEventJournal', () => {
  it('appends activity without changing the version of the task', () => {
    const { repo, journal } = setup();
    expect(repo.get(TaskId.parse('T-1')).version).toBe(2);
    for (let i = 0; i < 100; i++) {
      journal.append(activity('tool.used', `10:${String(10 + (i % 50)).padStart(2, '0')}`));
    }
    const task = repo.get(TaskId.parse('T-1'));
    expect(task.version).toBe(2);
    task.recordManualTime(ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(10), description: 'x' }), meta());
    repo.save(task);
    expect(repo.get(TaskId.parse('T-1')).version).toBe(3);
    expect(journal.readActivity(TaskId.parse('T-1'))).toHaveLength(100);
  });

  it('rejects an event that breaks the contract and leaves the journal as it was', () => {
    const { journal } = setup();
    const broken = { ...activity('turn.started', '10:00', { origin: 'user' }), data: { source: 'x', session: 's1', origin: 'robot' } };
    expect(() => journal.append(broken as never)).toThrow(InvalidActivityEvent);
    expect(() => journal.append(broken as never)).toThrow(/data\.origin/);
    expect(journal.readActivity(TaskId.parse('T-1'))).toEqual([]);
  });

  it('reads only valid activity events, skipping aggregate events and broken records', () => {
    const { layout, journal } = setup();
    journal.append(activity('turn.started', '10:00', { origin: 'user' }));
    const file = layout.taskJournal('T-1');
    appendFileSync(file, `${JSON.stringify({ ...activity('turn.ended', '10:10'), data: { source: 'x' } })}\n`);
    appendFileSync(file, '{"torn": \n');
    journal.append(activity('turn.ended', '10:20'));
    expect(journal.readActivity(TaskId.parse('T-1')).map((e) => e.type)).toEqual(['turn.started', 'turn.ended']);
  });
});

describe('FileTaskRepository with records', () => {
  it('stores and restores records and parallel mode through snapshot and journal', () => {
    const { layout, repo } = setup();
    const task = repo.get(TaskId.parse('T-1'));
    task.recordManualTime(
      ManualTime.of({ kind: 'agent', duration: Duration.ofHours(3), at: Timestamp.parse('2026-10-27T10:00:00.000Z'), description: 'before hooks' }),
      meta(),
    );
    task.recordExtra(Extra.of({ category: 'rework', description: 'redo', lines: 40 }), meta());
    task.enableParallelMode(ParallelModeChange.of({ agents: 2 }), meta());
    repo.save(task);
    const expected = task.toSnapshot();
    expect(repo.get(TaskId.parse('T-1')).toSnapshot()).toEqual(expected);

    // A snapshot from change 1 has no records; it must still load.
    writeYamlAtomic(layout.taskSnapshot('T-1'), { ...expected, manualTime: undefined, extras: undefined, parallelMode: undefined });
    expect(repo.listAll()[0]?.manualTime).toEqual([]);
    // A broken snapshot is rebuilt from the journal.
    writeYamlAtomic(layout.taskSnapshot('T-1'), { ...expected, manualTime: [{ kind: 'nope' }] });
    expect(repo.get(TaskId.parse('T-1')).toSnapshot()).toEqual(expected);
  });
});

describe('YamlEstimateReader', () => {
  function reader(content: string) {
    const dir = tempDir();
    writeFileSync(join(dir, 'plan.yaml'), content);
    return () => new YamlEstimateReader(dir).read('plan.yaml');
  }
  function issues(read: () => unknown) {
    try {
      read();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEstimate);
      return (error as InvalidEstimate).issues;
    }
    throw new Error('expected InvalidEstimate');
  }

  it('reads the coefficient of a calibrated estimate and refuses one that is not positive', () => {
    const base = 'schemaVersion: 1\ncalibrated: true\nparts:\n  - { name: a, hours: { optimistic: 1, likely: 13, pessimistic: 20 } }\n';
    const estimate = reader(`${base}calibration: { coefficient: 1.3 }\n`)();
    expect(estimate.toData().calibration).toEqual({ coefficient: 1.3 });
    expect(estimate.baseLikely).toBe(10);
    expect(issues(reader(`${base}calibration: { coefficient: 0 }\n`)).map((i) => i.path)).toEqual(['calibration.coefficient']);
  });

  it('reads a valid file with totals', () => {
    const estimate = reader(`schemaVersion: 1
type: feature
stack: [typescript]
calibrated: false
codeVolume: { production: [100, 300], tests: [50, 150] }
parts:
  - { name: impl, group: change-1, hours: { optimistic: 1, likely: 2, pessimistic: 4 } }
  - { name: tests, group: change-1, kind: auto-tests, who: agents, hours: { optimistic: 0.5, likely: 0.75, pessimistic: 1.5 } }
`)();
    expect(estimate.total.toData()).toEqual({ optimistic: 1.5, likely: 2.75, pessimistic: 5.5 });
    expect(estimate.partIds).toEqual(['change-1-impl', 'change-1-tests']);
  });

  it('reports a broken range with the path to the field', () => {
    expect(
      issues(reader('schemaVersion: 1\nparts:\n  - { name: a, hours: { optimistic: 2, likely: 1, pessimistic: 3 } }\n')),
    ).toEqual([{ path: 'parts[0].hours', message: 'expected optimistic ≤ likely ≤ pessimistic' }]);
  });

  it('reports a repeated id', () => {
    const found = issues(
      reader(`schemaVersion: 1
parts:
  - { id: x, name: a, hours: { optimistic: 1, likely: 1, pessimistic: 1 } }
  - { id: x, name: b, hours: { optimistic: 1, likely: 1, pessimistic: 1 } }
`),
    );
    expect(found).toEqual([{ path: 'parts[1].id', message: 'duplicate id "x" (also parts[0])' }]);
  });

  it('reports a typo in a field name and every other problem at once', () => {
    const found = issues(
      reader(`schemaVersion: 1
colour: red
parts:
  - { name: a, huors: { optimistic: 1, likely: 1, pessimistic: 1 } }
  - { name: b, kind: coding, hours: { optimistic: 1, likely: -1, pessimistic: 1 } }
`),
    );
    expect(found.map((issue) => issue.path)).toEqual([
      'colour',
      'parts[0].huors',
      'parts[0].hours',
      'parts[1].kind',
      'parts[1].hours.likely',
    ]);
  });

  it('reports a missing file and broken YAML as estimate errors', () => {
    expect(issues(() => new YamlEstimateReader(tempDir()).read('nope.yaml'))).toEqual([{ path: '', message: 'file not found' }]);
    expect(issues(reader('parts: [\n'))[0]?.message).toMatch(/not valid YAML/);
  });
});

describe('YamlConfigStore idle threshold', () => {
  let tempConfigRoot = '';
  function config(content?: string) {
    const root = join(tempDir(), 'home');
    tempConfigRoot = root;
    mkdirSync(root, { recursive: true });
    if (content !== undefined) {
      writeFileSync(join(root, 'config.yaml'), content);
    }
    return new YamlConfigStore(new StorageLayout(root), () => 'dev@example.com');
  }

  it('defaults to 30 minutes and reads measurement.idleMinutes', () => {
    expect(config().idlePolicy().threshold.minutes).toBe(30);
    expect(config('measurement:\n  idleMinutes: 60\n').idlePolicy().threshold.minutes).toBe(60);
  });

  it('keeps settings it does not know when it writes the author profile', () => {
    const store = config('measurement:\n  idleMinutes: 45\n  futureSetting: true\nauthor:\n  name: Dev\n');
    expect(store.current().id).toBe('dev@example.com');
    const written = readFileSync(join(tempConfigRoot, 'config.yaml'), 'utf8');
    expect(written).toContain('futureSetting: true');
    expect(written).toContain('name: Dev');
    expect(store.idlePolicy().threshold.minutes).toBe(45);
  });

  it('rejects a threshold out of range, naming the setting', () => {
    expect(() => config('measurement:\n  idleMinutes: 500\n').idlePolicy()).toThrow(InvalidValue);
    expect(() => config('measurement:\n  idleMinutes: soon\n').idlePolicy()).toThrow(/measurement\.idleMinutes/);
  });
});
