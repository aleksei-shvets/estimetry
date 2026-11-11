import { describe, expect, it } from 'vitest';
import type { SessionImportRequest } from '../../../src/application/task/import-session-logs.js';
import { PendingProposal } from '../../../src/application/hooks/pending-proposal.js';
import { RecentSessions } from '../../../src/application/hooks/recent-sessions.js';
import { SESSION_END_IMPORT_BUDGET_MS, SessionEndImport } from '../../../src/application/hooks/session-end-import.js';
import type { SessionBinding } from '../../../src/application/ports/session-bindings.js';
import type { TaskStatusReader, TaskSummary } from '../../../src/application/ports/task-status-reader.js';
import { SessionId } from '../../../src/domain/measurement/session-id.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { InMemoryCloseProposals } from '../../support/closing-fakes.js';
import { FixedMeasurementSettings } from '../../support/fakes.js';
import { InMemoryCheckpointState, InMemorySessionBindings } from '../../support/hook-fakes.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
const s1 = SessionId.parse('s1');

describe('a pending proposal to close a task', () => {
  function setup(plan: () => { done?: number; unfinished: readonly string[] } = () => ({ done: 80, unfinished: ['release'] })) {
    const proposals = new InMemoryCloseProposals();
    const state = new InMemoryCheckpointState();
    let loads = 0;
    const proposal = new PendingProposal(proposals, new RecentSessions(state, new FixedMeasurementSettings()), async () => {
      loads += 1;
      return { of: plan };
    });
    proposals.put('T-1', { change: 'add-x', completedAt: at('10:00').toISOString(), session: 's1' });
    return { proposals, state, proposal, loads: () => loads };
  }

  it('is taken once by the session that noticed the completion, with the plan in its text', async () => {
    const { proposal } = setup();
    const text = await proposal.take('T-1', s1, '/work/api', at('10:05'));
    expect(text).toContain('add-x');
    expect(text).toContain('80%');
    expect(text).toContain('release');
    expect(await proposal.take('T-1', s1, '/work/api', at('10:06'))).toBeUndefined();
  });

  it('waits for another session while the one that noticed it is active, and loads no plan meanwhile', async () => {
    const { state, proposal, loads } = setup();
    state.write(s1, { lastSeenAt: at('10:04').toISOString() });
    expect(await proposal.take('T-1', SessionId.parse('s2'), '/work/api', at('10:05'))).toBeUndefined();
    expect(loads()).toBe(0);
    expect(await proposal.take('T-1', SessionId.parse('s2'), '/work/api', at('12:00'))).toContain('add-x');
  });

  it('goes without the plan when the plan cannot be read', async () => {
    const { proposal } = setup(() => {
      throw new Error('no plan');
    });
    expect(await proposal.take('T-1', s1, '/work/api', at('10:05'))).toContain('add-x');
  });

  it('is nothing when there is no proposal', async () => {
    const { proposal, loads } = setup();
    expect(await proposal.take('T-2', s1, '/work/api', at('10:05'))).toBeUndefined();
    expect(loads()).toBe(0);
  });
});

describe('the import of the log at the end of a session', () => {
  const summary = (id: string, status: TaskSummary['status'], projects: string[] = ['api']): TaskSummary => ({ id, title: id, status, projects });

  function setup(binding: SessionBinding | undefined, summaries: TaskSummary[], withLogs = true) {
    const bindings = new InMemorySessionBindings();
    if (binding !== undefined) {
      bindings.bindings.set(binding.session, binding);
    }
    const tasks: TaskStatusReader = { summary: (id) => summaries.find((s) => s.id === id), inProgress: () => [] };
    const imports: SessionImportRequest[] = [];
    const logs = async () => ({ execute: (request: SessionImportRequest) => (imports.push(request), []) });
    return { imports, end: new SessionEndImport(bindings, tasks, withLogs ? logs : undefined) };
  }

  it('imports into every task in progress the session served, with the path it knows and the budget', async () => {
    const binding: SessionBinding = { session: 's1', project: 'api', root: '/work/api', task: 'T-2', tasks: ['T-1', 'T-3'], transcript: '/logs/kept.jsonl' };
    const { imports, end } = setup(binding, [summary('T-1', 'in-progress', ['web']), summary('T-2', 'in-progress', []), summary('T-3', 'closed')]);
    await end.run('claude-code', s1, undefined);
    expect(imports).toEqual([
      {
        session: 's1',
        source: 'claude-code',
        path: '/logs/kept.jsonl',
        tasks: [
          { id: 'T-1', project: 'web' },
          { id: 'T-2', project: 'api' },
        ],
        budgetMs: SESSION_END_IMPORT_BUDGET_MS,
      },
    ]);
  });

  it('prefers the path of the hook to the kept one', async () => {
    const { imports, end } = setup({ session: 's1', project: 'api', root: '/work/api', task: 'T-1', transcript: '/logs/kept.jsonl' }, [summary('T-1', 'in-progress')]);
    await end.run('claude-code', s1, '/logs/now.jsonl');
    expect(imports[0]?.path).toBe('/logs/now.jsonl');
  });

  it('does nothing without tasks in progress or without an importer', async () => {
    const closed = setup({ session: 's1', project: 'api', root: '/work/api', task: 'T-1' }, [summary('T-1', 'closed')]);
    await closed.end.run('claude-code', s1, undefined);
    expect(closed.imports).toEqual([]);
    const unbound = setup(undefined, []);
    await unbound.end.run('claude-code', s1, undefined);
    expect(unbound.imports).toEqual([]);
    const without = setup({ session: 's1', project: 'api', root: '/work/api', task: 'T-1' }, [summary('T-1', 'in-progress')], false);
    await without.end.run('claude-code', s1, undefined);
    expect(without.imports).toEqual([]);
  });
});
