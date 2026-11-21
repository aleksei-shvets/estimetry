import type { IntervalSet } from '../measurement/interval-set.js';
import type { SessionLog, TokenBucket, TokenCounts } from '../progress/session-log.js';

/*
 * Tokens and cost of a task from the logs of its sessions (effort-metrics,
 * tokens and cost of a task). Pure: the logs and the spans in which each
 * session served the task come in as arguments.
 */

/**
 * Relative weight of a token of each kind (an input token is 1), the structure of Claude prices, the only tool that
 * reports a cost: fitted without residue to the totals of the studied sessions; prices themselves are not in the
 * code. A cache write without a lifetime weighs as the short one. The cost of a session stays exact whatever the
 * weights: they only split it between tasks.
 */
export const TOKEN_WEIGHTS: Required<TokenCounts> = {
  input: 1,
  output: 5,
  cacheRead: 0.05,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
  cacheWrite: 1.25,
};

export interface TaskUsage {
  readonly tokens: ReadonlyMap<string, TokenCounts>;
  /** Null when some session with a cost has a model of unknown cost, or no session has a cost. */
  readonly costUSD: number | null;
  /** Some session has tokens outside the task (before its start, in another task): the split depends on the weights. */
  readonly approximate: boolean;
  /** Sessions with activity in the task, how many of them have a log, and how many of those a cost. */
  readonly sessions: number;
  readonly withLogs: number;
  readonly withCost: number;
}

export interface UsageInput {
  readonly logs: ReadonlyMap<string, SessionLog>;
  /** By session with activity: where it served the task. */
  readonly spans: ReadonlyMap<string, IntervalSet>;
}

/** Undefined when no session of the task has a log. */
export function taskUsage(input: UsageInput): TaskUsage | undefined {
  const tokens = new Map<string, TokenCounts>();
  let cost: number | null = 0;
  let approximate = false;
  let withLogs = 0;
  let withCost = 0;
  for (const [session, spans] of input.spans) {
    const log = input.logs.get(session);
    if (log === undefined) {
      continue;
    }
    withLogs += 1;
    const buckets = [...log.turns.flatMap((turn) => turn.tokens), ...[...log.agents.values()].flatMap((agent) => agent.tokens)];
    const mine = buckets.filter((bucket) => inside(spans, bucket.at));
    for (const bucket of mine) {
      tokens.set(bucket.model, add(tokens.get(bucket.model), bucket));
    }
    const all = weight(buckets);
    const own = weight(mine);
    if (own < all) {
      approximate = true;
    }
    if (!log.reportsCost) {
      continue; // its tokens count; its cost is not known to the tool, so it is no part of the cost
    }
    withCost += 1;
    const totals = [...log.cost.values()];
    if (totals.some((total) => total.unknown)) {
      cost = null;
    } else if (cost !== null && all > 0) {
      cost += (totals.reduce((sum, total) => sum + total.totalUSD, 0) * own) / all;
    }
  }
  if (withLogs === 0) {
    return undefined;
  }
  return { tokens, costUSD: withCost === 0 ? null : cost, approximate, sessions: input.spans.size, withLogs, withCost };
}

function weight(buckets: readonly TokenBucket[]): number {
  return buckets.reduce(
    (sum, b) =>
      sum +
      b.input * TOKEN_WEIGHTS.input +
      b.output * TOKEN_WEIGHTS.output +
      b.cacheRead * TOKEN_WEIGHTS.cacheRead +
      b.cacheWrite5m * TOKEN_WEIGHTS.cacheWrite5m +
      b.cacheWrite1h * TOKEN_WEIGHTS.cacheWrite1h +
      (b.cacheWrite ?? 0) * TOKEN_WEIGHTS.cacheWrite,
    0,
  );
}

function add(sum: TokenCounts | undefined, bucket: TokenCounts): TokenCounts {
  return {
    input: (sum?.input ?? 0) + bucket.input,
    output: (sum?.output ?? 0) + bucket.output,
    cacheRead: (sum?.cacheRead ?? 0) + bucket.cacheRead,
    cacheWrite5m: (sum?.cacheWrite5m ?? 0) + bucket.cacheWrite5m,
    cacheWrite1h: (sum?.cacheWrite1h ?? 0) + bucket.cacheWrite1h,
    ...(sum?.cacheWrite === undefined && bucket.cacheWrite === undefined
      ? {}
      : { cacheWrite: (sum?.cacheWrite ?? 0) + (bucket.cacheWrite ?? 0) }),
  };
}

/**
 * A bucket belongs to the task when its middle lies inside a span: the error
 * at the edges of a span is then at most half a bucket either way, not a whole
 * bucket lost at every start.
 */
function inside(spans: IntervalSet, at: number): boolean {
  const middle = at + BUCKET_MS / 2;
  return spans.intervals.some((interval) => interval.start.toMillis() <= middle && middle < interval.end.toMillis());
}

/** The width of a token bucket of a session log. */
const BUCKET_MS = 5 * 60_000;

/** The usage of a task as a card and `emt status` give it: tokens by model, the cost in cents. */
export function usageSummary(usage: TaskUsage): {
  readonly tokens: Readonly<Record<string, TokenCounts>>;
  readonly costUSD: number | null;
  readonly approximate: boolean;
  readonly sessions: number;
  readonly withLogs: number;
  readonly withCost: number;
} {
  return {
    tokens: Object.fromEntries(usage.tokens),
    costUSD: usage.costUSD === null ? null : Math.round(usage.costUSD * 100) / 100,
    approximate: usage.approximate,
    sessions: usage.sessions,
    withLogs: usage.withLogs,
    withCost: usage.withCost,
  };
}
