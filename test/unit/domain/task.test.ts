import { describe, expect, it } from 'vitest';
import { ProjectId } from '../../../src/domain/project/project-id.js';
import { Author } from '../../../src/domain/shared/author.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import type { EventMeta } from '../../../src/domain/shared/event-envelope.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { Task } from '../../../src/domain/task/task.js';
import { InvalidTransition, UnknownTaskType } from '../../../src/domain/task/task-errors.js';
import { TaskId } from '../../../src/domain/task/task-id.js';
import { DEFAULT_TASK_TYPES, TaskType } from '../../../src/domain/task/task-type.js';

let seq = 0;
function meta(minute = 0): EventMeta {
  seq += 1;
  return {
    id: `e-${seq}`,
    at: Timestamp.parse(`2026-10-27T10:${String(minute).padStart(2, '0')}:00.000Z`),
    author: Author.of('dev@example.com'),
  };
}

const api = ProjectId.parse('api');
const web = ProjectId.parse('web');

function newTask(): Task {
  return Task.create(
    { id: TaskId.fromNumber(1), title: ' Payment webhook ', type: TaskType.of('integration', DEFAULT_TASK_TYPES), ticket: 'PAY-42', project: api },
    meta(),
  );
}

describe('Task', () => {
  it('is created as new, unestimated, in its project, with one pending event', () => {
    const task = newTask();
    expect(task.toSnapshot()).toMatchObject({
      id: 'T-1',
      title: 'Payment webhook',
      type: 'integration',
      ticket: 'PAY-42',
      status: 'new',
      estimated: false,
      projects: ['api'],
      version: 1,
    });
    const events = task.pullEvents();
    expect(events.map((e) => e.type)).toEqual(['task.created']);
    expect(events[0]).toMatchObject({ schemaVersion: 1, task: 'T-1', project: 'api', author: 'dev@example.com' });
    expect(task.pullEvents()).toEqual([]);
  });

  it('rejects an empty title and an unknown type', () => {
    expect(() =>
      Task.create({ id: TaskId.fromNumber(1), title: '  ', type: TaskType.of('feature', DEFAULT_TASK_TYPES), project: api }, meta()),
    ).toThrow(InvalidValue);
    expect(() => TaskType.of('banana', DEFAULT_TASK_TYPES)).toThrow(UnknownTaskType);
  });

  it('starts once and records whether it had an estimate', () => {
    const task = newTask();
    task.start(api, meta(5));
    expect(task.status).toBe('in-progress');
    expect(task.toSnapshot().startedAt).toBe('2026-10-27T10:05:00.000Z');
    expect(task.pullEvents().at(-1)).toMatchObject({ type: 'task.started', data: { estimated: false } });
    expect(() => task.start(api, meta())).toThrow(InvalidTransition);
    expect(task.pullEvents()).toEqual([]);
  });

  it('attaches another project once', () => {
    const task = newTask();
    expect(task.attach(web, meta())).toBe(true);
    expect(task.attach(web, meta())).toBe(false);
    expect(task.attach(api, meta())).toBe(false);
    expect(task.projects).toEqual([api, web]);
    expect(task.pullEvents().map((e) => e.type)).toEqual(['task.created', 'task.attached']);
  });

  it('rebuilt from its journal equals the one restored from its snapshot', () => {
    const task = newTask();
    task.attach(web, meta(1));
    task.start(web, meta(2));
    const events = task.pullEvents();

    const fromEvents = Task.fromEvents(events);
    const fromSnapshot = Task.rehydrate(task.toSnapshot());

    expect(fromEvents.toSnapshot()).toEqual(task.toSnapshot());
    expect(fromSnapshot.toSnapshot()).toEqual(task.toSnapshot());
    expect(fromEvents.loadedVersion).toBe(3);
    expect(fromSnapshot.loadedVersion).toBe(3);
  });

  it('refuses a journal that does not start with task.created', () => {
    const task = newTask();
    task.start(api, meta());
    const [, started] = task.pullEvents();
    expect(() => Task.fromEvents([started!])).toThrow(InvalidValue);
  });
});

describe('TaskId', () => {
  it('parses and formats T-<n>', () => {
    expect(TaskId.parse('T-12').toString()).toBe('T-12');
    expect(() => TaskId.parse('T-0')).toThrow(InvalidValue);
    expect(() => TaskId.parse('12')).toThrow(InvalidValue);
  });
});

describe('ProjectId', () => {
  it('derives kebab-case ids from directory names', () => {
    expect(ProjectId.fromName('my-app').value).toBe('my-app');
    expect(ProjectId.fromName('My App').value).toBe('my-app');
    expect(ProjectId.fromName('Acme_mobile').value).toBe('acme-mobile');
    expect(ProjectId.fromName('___').value).toBe('project');
  });

  it('picks the first free suffix', () => {
    const base = ProjectId.parse('my-app');
    expect(ProjectId.firstFree(base, new Set()).value).toBe('my-app');
    expect(ProjectId.firstFree(base, new Set(['my-app', 'my-app-2'])).value).toBe('my-app-3');
  });
});
