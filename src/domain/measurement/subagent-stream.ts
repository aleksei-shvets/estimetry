import type { Collector } from './collector.js';
import { holdsRun, lastRecordBefore } from './log-matching.js';
import type { Prepared } from './prepared-events.js';
import { Run, type StreamContext } from './run.js';
import { key, MAIN } from './timeline.js';

/** A subagent runs from `agent.started` (or its first event) to `agent.stopped`. */
export function subagentStream(
  session: string,
  agent: string,
  items: readonly Prepared[],
  sessionEnds: readonly number[],
  c: Collector,
  ctx: StreamContext,
): void {
  const agentKey = key(session, agent);
  c.describe(agentKey, { session, agent, parent: key(session, MAIN), background: false });
  let run: Run | undefined;
  const spans = ctx.log?.agents.get(agent);
  /** A run without `agent.stopped`: its log's last record before `next` ends it; without a log the rest is doubtful. */
  const abandon = (next: number): void => {
    if (!run) {
      return;
    }
    if (spans !== undefined && holdsRun(spans, run.last, next)) {
      run.end(Math.max(run.last, lastRecordBefore(spans, next) ?? run.last));
      return;
    }
    c.doubt(session, agentKey, false, run.last, Math.min(run.last + c.idle, next));
  };

  for (const { event, at } of items) {
    if (event.type === 'agent.started') {
      abandon(at);
      c.describe(agentKey, {
        session,
        agent,
        parent: key(session, event.data.parentAgent ?? MAIN),
        background: event.data.background ?? false,
      });
      run = new Run(session, agentKey, at, c);
      continue;
    }
    run ??= new Run(session, agentKey, at, c);
    run.step(event, at);
    if (event.type === 'agent.stopped') {
      run = undefined;
    }
  }

  if (run) {
    const last = run.last;
    const sessionEnd = sessionEnds.find((end) => end >= last);
    if (sessionEnd !== undefined) {
      run.end(sessionEnd);
    } else if (ctx.now - last <= c.idle) {
      run.end(ctx.now);
    } else {
      abandon(ctx.now);
    }
  }
}
