import type { CostTotalData, LogTurnData, TokenBucketData } from '../../../../application/contracts/session-logs.js';

/*
 * Turns lines of a Claude Code session log into turns, tokens and cost totals.
 * Fields are read one by one and checked; texts are looked at only to tell an
 * interruption marker by its start and never leave this module.
 */

/** Records the reader knows: the ones it uses and the service records it skips silently. */
const USED_TYPES: ReadonlySet<string> = new Set(['user', 'assistant', 'system', 'cost-state']);
const SERVICE_TYPES: ReadonlySet<string> = new Set([
  'attachment',
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'last-prompt',
  'atis-latch',
  'ai-title',
  'custom-title',
  'mode',
  'queue-operation',
  'session-owner',
  'file-history-snapshot',
  'file-history-delta',
  'frame-link',
  'tools-used',
  'permission-mode',
  'pr-link',
  'summary',
  'progress',
  'artifact-comment-monitor',
  'artifact-autoreact-ledger',
]);

const INTERRUPTION = '[Request interrupted';
const SYNTHETIC = '<synthetic>';
/** A record of a resumed session may carry a time long before the turn it is in. */
const BEFORE_TURN_TOLERANCE_MS = 5_000;
const BUCKET_MS = 5 * 60_000;
/** Neighbouring records of a subagent closer than this make one stretch. */
const SPAN_GAP_MS = 60_000;

type Json = Record<string, unknown>;

/** What a line says, without any of its texts. */
interface Summary {
  readonly offset: number;
  readonly kind: 'user' | 'assistant' | 'system' | 'other';
  readonly at: number | undefined;
  readonly origin: boolean;
  readonly compact: boolean;
  readonly meta: boolean;
  readonly text: boolean;
  readonly toolResult: boolean;
  readonly interruption: boolean;
  readonly endTurn: boolean;
  readonly stopHook: boolean;
  readonly synthetic: boolean;
  readonly message?: { readonly id: string; readonly model: string; readonly tokens: Tokens };
}

interface Tokens {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

/** Collects the lines of one file; `result` builds turns once all are in. */
export class MainLogParser {
  private readonly lines: Summary[] = [];
  private readonly costs = new Map<number, CostTotalData>();
  skipped = 0;
  /** Lines with any content: an empty log means a session opened and closed. */
  records = 0;
  /** User or assistant records with a time: without them the format is not recognized. */
  recognized = 0;
  private withOrigin = false;

  constructor(private readonly from: number) {}

  add(offset: number, text: string): void {
    if (text.trim() === '') {
      return;
    }
    this.records += 1;
    const record = parse(text);
    if (record === undefined || typeof record['type'] !== 'string') {
      this.skipped += 1;
      return;
    }
    const type = record['type'];
    if (!USED_TYPES.has(type)) {
      if (!SERVICE_TYPES.has(type)) {
        this.skipped += 1;
      }
      return;
    }
    if (type === 'cost-state') {
      const startTime = record['startTime'];
      const total = record['totalCostUSD'];
      if (
        typeof startTime === 'number' &&
        Number.isFinite(startTime) &&
        typeof total === 'number' &&
        Number.isFinite(total) &&
        total >= 0
      ) {
        this.costs.set(startTime, { startTime, totalUSD: total, unknown: record['hasUnknownModelCost'] === true });
      } else {
        this.skipped += 1;
      }
      return;
    }
    const summary = summarize(offset, type as Summary['kind'], record);
    if (summary.at !== undefined && summary.kind !== 'system') {
      this.recognized += 1;
    }
    if (summary.origin) {
      this.withOrigin = true;
    }
    this.lines.push(summary);
  }

  result(): { turns: LogTurnData[]; next: number; cost: CostTotalData[] } {
    const turns: Building[] = [];
    let current: Building = new Building(this.from, undefined);
    const seen = new Set<string>();
    for (const line of this.lines) {
      if (line.kind === 'user' && this.startsTurn(line)) {
        if (current.start !== undefined || current.hasTokens) {
          turns.push(current);
        }
        current = new Building(line.offset, line.at);
      } else {
        current.take(line);
      }
      if (line.message !== undefined && !line.synthetic && !seen.has(line.message.id) && line.at !== undefined) {
        seen.add(line.message.id);
        current.tokens(line.at, line.message.model, line.message.tokens);
      }
    }
    if (current.start !== undefined || current.hasTokens) {
      turns.push(current);
    }
    const last = [...turns].reverse().find((turn) => turn.start !== undefined);
    return {
      turns: turns.map((turn) => turn.data()),
      next: last?.key ?? this.from,
      cost: [...this.costs.values()],
    };
  }

  private startsTurn(line: Summary): boolean {
    if (line.at === undefined) {
      return false;
    }
    if (this.withOrigin) {
      return line.origin && !line.compact;
    }
    return line.text && !line.meta && !line.toolResult && !line.interruption;
  }
}

class Building {
  private ends: number[] = [];
  private fallback: number | undefined;
  private readonly buckets = new Map<string, TokenBucketData>();

  constructor(
    readonly key: number,
    readonly start: number | undefined,
  ) {}

  get hasTokens(): boolean {
    return this.buckets.size > 0;
  }

  take(line: Summary): void {
    const at = line.at;
    if (this.start === undefined || at === undefined || at < this.start - BEFORE_TURN_TOLERANCE_MS) {
      return; // records of a resumed session: their tokens count, their times do not
    }
    if ((line.kind === 'assistant' && line.endTurn && !line.synthetic) || (line.kind === 'system' && line.stopHook) || line.interruption) {
      this.ends.push(at);
    }
    if ((line.kind === 'assistant' && !line.synthetic) || line.toolResult) {
      this.fallback = Math.max(this.fallback ?? at, at);
    }
  }

  tokens(at: number, model: string, tokens: Tokens): void {
    addTokens(this.buckets, at, model, tokens);
  }

  data(): LogTurnData {
    const tokens = [...this.buckets.values()];
    if (this.start === undefined) {
      return { key: this.key, tokens };
    }
    const end = this.ends.length > 0 ? Math.max(...this.ends) : (this.fallback ?? this.start);
    return { key: this.key, start: this.start, end: Math.max(end, this.start), tokens };
  }
}

/** A subagent's file: stretches of its records and its tokens. */
export class AgentLogParser {
  private readonly times: number[] = [];
  private readonly buckets = new Map<string, TokenBucketData>();
  private readonly seen = new Set<string>();

  add(text: string): void {
    if (text.trim() === '') {
      return;
    }
    const record = parse(text);
    const type = record?.['type'];
    if (record === undefined || (type !== 'user' && type !== 'assistant')) {
      return;
    }
    const summary = summarize(0, type, record);
    if (summary.at === undefined || summary.synthetic) {
      return;
    }
    this.times.push(summary.at);
    if (summary.message !== undefined && !this.seen.has(summary.message.id)) {
      this.seen.add(summary.message.id);
      addTokens(this.buckets, summary.at, summary.message.model, summary.message.tokens);
    }
  }

  result(): { spans: [number, number][]; tokens: TokenBucketData[] } {
    const sorted = [...this.times].sort((a, b) => a - b);
    const spans: [number, number][] = [];
    for (const at of sorted) {
      const last = spans.at(-1);
      if (last !== undefined && at - last[1] < SPAN_GAP_MS) {
        last[1] = at;
      } else {
        spans.push([at, at]);
      }
    }
    return { spans, tokens: [...this.buckets.values()] };
  }
}

function addTokens(buckets: Map<string, TokenBucketData>, at: number, model: string, tokens: Tokens): void {
  const bucket = Math.floor(at / BUCKET_MS) * BUCKET_MS;
  const key = `${bucket} ${model}`;
  const before = buckets.get(key);
  buckets.set(key, {
    at: bucket,
    model,
    input: (before?.input ?? 0) + tokens.input,
    output: (before?.output ?? 0) + tokens.output,
    cacheRead: (before?.cacheRead ?? 0) + tokens.cacheRead,
    cacheWrite5m: (before?.cacheWrite5m ?? 0) + tokens.cacheWrite5m,
    cacheWrite1h: (before?.cacheWrite1h ?? 0) + tokens.cacheWrite1h,
  });
}

function parse(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
  } catch {
    return undefined; // the parser's message would repeat a piece of the line
  }
}

function summarize(offset: number, kind: Summary['kind'], record: Json): Summary {
  const stamp = record['timestamp'];
  const parsed = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN;
  const message = object(record['message']);
  const content = message?.['content'];
  const parts = Array.isArray(content) ? content.filter((part): part is Json => typeof part === 'object' && part !== null) : [];
  const toolResult = parts.some((part) => part['type'] === 'tool_result');
  const texts = typeof content === 'string' ? [content] : parts.filter((part) => part['type'] === 'text').map((part) => part['text']);
  const interruption = kind === 'user' && texts.some((text) => typeof text === 'string' && text.startsWith(INTERRUPTION));
  const model = message?.['model'];
  const synthetic = kind === 'assistant' && model === SYNTHETIC;
  return {
    offset,
    kind: kind === 'user' || kind === 'assistant' || kind === 'system' ? kind : 'other',
    at: Number.isFinite(parsed) ? parsed : undefined,
    origin: kind === 'user' && record['turnOrigin'] !== undefined && record['turnOrigin'] !== null,
    compact: record['isCompactSummary'] === true,
    meta: record['isMeta'] === true,
    text: kind === 'user' && !toolResult && texts.length > 0,
    toolResult,
    interruption,
    endTurn: kind === 'assistant' && message?.['stop_reason'] === 'end_turn',
    stopHook: kind === 'system' && record['subtype'] === 'stop_hook_summary',
    synthetic,
    ...(kind === 'assistant' && !synthetic ? messageOf(message) : {}),
  };
}

function messageOf(message: Json | undefined): { message?: NonNullable<Summary['message']> } {
  const id = message?.['id'];
  const model = message?.['model'];
  const usage = object(message?.['usage']);
  if (typeof id !== 'string' || typeof model !== 'string' || model === '' || usage === undefined) {
    return {};
  }
  const split = object(usage['cache_creation']);
  const write = count(usage['cache_creation_input_tokens']);
  const write1h = split === undefined ? 0 : count(split['ephemeral_1h_input_tokens']);
  const write5m = split === undefined ? write : count(split['ephemeral_5m_input_tokens']);
  return {
    message: {
      id,
      model,
      tokens: {
        input: count(usage['input_tokens']),
        output: count(usage['output_tokens']),
        cacheRead: count(usage['cache_read_input_tokens']),
        cacheWrite5m: write5m,
        cacheWrite1h: write1h,
      },
    },
  };
}

function object(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
