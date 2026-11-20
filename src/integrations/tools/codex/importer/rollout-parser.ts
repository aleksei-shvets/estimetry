import type { LogTurnData, TokenBucketData } from '../../../../application/contracts/session-logs.js';

/*
 * One rollout file of Codex (codex-session-logs spec): `{"timestamp", "type", "payload"}` per line. Only times, turn
 * keys, models and token counts are read; texts of messages, reasoning, tool calls and instructions are never kept.
 */

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'session_meta',
  'response_item',
  'event_msg',
  'turn_context',
  'compacted',
  'token_usage_record',
  'inter_agent_communication',
  'inter_agent_communication_metadata',
  'world_state',
  'retained_context',
  'dynamic_tools_updated',
  'security_risk_score',
  'realtime_item',
]);
const BUCKET_MS = 5 * 60_000;
/** A rollout gives no model before its first `turn_context`; tokens there still count. */
const UNKNOWN_MODEL = 'unknown';

type Json = Record<string, unknown>;

interface OpenTurn {
  key: number;
  start?: number;
  end?: number;
  tokens: Map<string, TokenBucketData>;
}

export class RolloutParser {
  records = 0;
  /** Records of a known type; a file whose records are all unknown is not a rollout. */
  recognized = 0;
  /** A rollout starts with `session_meta`; its absence in a file read from the start means another format. */
  sessionMeta = false;
  skipped = 0;
  private readonly turns: OpenTurn[] = [];
  private readonly byKey = new Map<string, OpenTurn>();
  private readonly responses = new Set<string>();
  private model = UNKNOWN_MODEL;
  private usageRecords = false;
  /** The running total of the last `token_count` counted. */
  private lastTotal: number | undefined;
  private readonly countTokens: OpenTurn;

  constructor(private readonly from: number) {
    // Tokens before the first turn of the part read belong to a turn without times, keyed by where the read began.
    this.countTokens = { key: from, tokens: new Map() };
  }

  add(offset: number, line: string): void {
    let record: Json;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        this.skipped += 1;
        return;
      }
      record = value as Json;
    } catch {
      this.skipped += 1;
      return;
    }
    this.records += 1;
    const type = typeof record['type'] === 'string' ? record['type'] : '';
    const at = Date.parse(typeof record['timestamp'] === 'string' ? record['timestamp'] : '');
    const payload = isObject(record['payload']) ? record['payload'] : {};
    if (!KNOWN_TYPES.has(type) || Number.isNaN(at)) {
      this.skipped += 1;
      return;
    }
    this.recognized += 1;
    if (type === 'session_meta') {
      this.sessionMeta = true;
    } else if (type === 'turn_context' && typeof payload['model'] === 'string' && payload['model'] !== '') {
      this.model = payload['model'];
    } else if (type === 'event_msg') {
      this.event(offset, at, payload);
    } else if (type === 'token_usage_record') {
      this.usage(at, payload['response_id'], payload['usage']);
    }
  }

  /** Turns from the part read, and where the next read starts: the first line of its last turn. */
  result(): { readonly turns: LogTurnData[]; readonly next: number } {
    const turns = [...(this.countTokens.tokens.size > 0 ? [this.countTokens] : []), ...this.turns].map(
      (turn): LogTurnData => ({
        key: turn.key,
        ...(turn.start === undefined ? {} : { start: turn.start }),
        ...(turn.end === undefined ? {} : { end: turn.end }),
        tokens: [...turn.tokens.values()],
      }),
    );
    return { turns, next: this.turns.at(-1)?.key ?? this.from };
  }

  private event(offset: number, at: number, payload: Json): void {
    const kind = payload['type'];
    const turnId = typeof payload['turn_id'] === 'string' ? payload['turn_id'] : undefined;
    if (kind === 'task_started' && turnId !== undefined) {
      const turn: OpenTurn = { key: offset, start: at, tokens: new Map() };
      this.turns.push(turn);
      this.byKey.set(turnId, turn);
    } else if ((kind === 'task_complete' || kind === 'turn_aborted') && turnId !== undefined) {
      const turn = this.byKey.get(turnId);
      if (turn !== undefined) {
        turn.end = Math.max(turn.end ?? at, at);
      }
    } else if (kind === 'token_count' && !this.usageRecords) {
      const info = isObject(payload['info']) ? payload['info'] : undefined;
      // Codex repeats the event with the same running total (rate limits, a resumed thread): no new response then.
      const total = isObject(info?.['total_token_usage']) ? info['total_token_usage']['total_tokens'] : undefined;
      if (typeof total === 'number' && total === this.lastTotal) {
        return;
      }
      if (typeof total === 'number') {
        this.lastTotal = total; // an event without a total does not forget the last one
      }
      this.count(at, info?.['last_token_usage']);
    }
  }

  /** One response's usage, once per response; the newer record wins over the running `token_count`. */
  private usage(at: number, response: unknown, usage: unknown): void {
    if (!this.usageRecords) {
      // A file with these records counts only them: `token_count` repeats the same responses.
      this.usageRecords = true;
      for (const turn of [this.countTokens, ...this.turns]) {
        turn.tokens.clear();
      }
    }
    if (typeof response === 'string') {
      if (this.responses.has(response)) {
        return;
      }
      this.responses.add(response);
    }
    this.count(at, usage);
  }

  private count(at: number, usage: unknown): void {
    if (!isObject(usage)) {
      return;
    }
    const input = number(usage['input_tokens']);
    const cached = Math.min(number(usage['cached_input_tokens']), input);
    const turn = this.turns.at(-1) ?? this.countTokens;
    const bucketAt = Math.floor(at / BUCKET_MS) * BUCKET_MS;
    const key = `${this.model}\u0000${bucketAt}`;
    const before = turn.tokens.get(key);
    turn.tokens.set(key, {
      at: bucketAt,
      model: this.model,
      // OpenAI counts cached input inside the input: only the rest is new input.
      input: (before?.input ?? 0) + input - cached,
      output: (before?.output ?? 0) + number(usage['output_tokens']),
      cacheRead: (before?.cacheRead ?? 0) + cached,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheWrite: (before?.cacheWrite ?? 0) + number(usage['cache_write_input_tokens']),
    });
  }
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
