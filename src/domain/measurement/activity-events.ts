import { DomainError } from '../shared/domain-error.js';
import type { EventEnvelope } from '../shared/event-envelope.js';

/*
 * Normalized activity events: the contract between AI-tool adapters and the
 * core. Nothing here names a particular tool; adapters translate their hooks
 * into these events (see the activity-events spec for the rules they follow).
 */

export const ACTIVITY_EVENT_SCHEMA_VERSION = 1;

export const TURN_ORIGINS = ['user', 'automated'] as const;
export type TurnOrigin = (typeof TURN_ORIGINS)[number];

export const TURN_OUTCOMES = ['completed', 'interrupted', 'error'] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

export const AWAITING_REASONS = ['permission', 'question', 'other'] as const;
export type AwaitingReason = (typeof AWAITING_REASONS)[number];

interface SessionData {
  /** Id of the adapter that wrote the event, e.g. `claude-code`. */
  readonly source: string;
  /** Session id in the AI tool. */
  readonly session: string;
}

/** Absent for the main agent of the session; the subagent id otherwise. */
interface AgentData extends SessionData {
  readonly agent?: string;
}

interface ToolData extends AgentData {
  readonly tool?: string;
  readonly toolUseId?: string;
}

export type SessionStarted = EventEnvelope<'session.started', SessionData & { readonly resumed?: boolean }>;
export type SessionEnded = EventEnvelope<'session.ended', SessionData>;
export type TurnStarted = EventEnvelope<'turn.started', AgentData & { readonly origin: TurnOrigin }>;
export type TurnEnded = EventEnvelope<'turn.ended', AgentData & { readonly outcome?: TurnOutcome }>;
export type TurnAwaitingInput = EventEnvelope<'turn.awaiting-input', AgentData & { readonly reason?: AwaitingReason }>;
export type ToolStarted = EventEnvelope<'tool.started', ToolData>;
export type ToolUsed = EventEnvelope<
  'tool.used',
  ToolData & { readonly durationMs?: number; readonly failed?: boolean }
>;
export type AgentStarted = EventEnvelope<
  'agent.started',
  SessionData & { readonly agent: string; readonly parentAgent?: string; readonly agentType?: string; readonly background?: boolean }
>;
export type AgentStopped = EventEnvelope<'agent.stopped', SessionData & { readonly agent: string }>;

export type ActivityEvent =
  | SessionStarted
  | SessionEnded
  | TurnStarted
  | TurnEnded
  | TurnAwaitingInput
  | ToolStarted
  | ToolUsed
  | AgentStarted
  | AgentStopped;

export type ActivityEventType = ActivityEvent['type'];

export const ACTIVITY_EVENT_TYPES: readonly ActivityEventType[] = [
  'session.started',
  'session.ended',
  'turn.started',
  'turn.ended',
  'turn.awaiting-input',
  'tool.started',
  'tool.used',
  'agent.started',
  'agent.stopped',
];

export function isActivityEventType(type: unknown): type is ActivityEventType {
  return typeof type === 'string' && (ACTIVITY_EVENT_TYPES as readonly string[]).includes(type);
}

/** An activity event that breaks the contract; `path` names the offending field. */
export class InvalidActivityEvent extends DomainError {
  readonly code = 'invalid-activity-event';

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`invalid activity event: ${path} ${reason}`);
  }
}

type Json = Record<string, unknown>;

/**
 * Checks a record against the contract and returns it typed. Unknown fields are
 * tolerated, so a journal written by a newer version stays readable.
 * @throws InvalidActivityEvent
 */
export function parseActivityEvent(value: unknown): ActivityEvent {
  const record = object(value, '(event)');
  number(record, 'schemaVersion');
  string(record, 'id');
  const ts = string(record, 'ts');
  if (Number.isNaN(Date.parse(ts))) {
    throw new InvalidActivityEvent('ts', `must be an ISO 8601 time, got "${ts}"`);
  }
  const type = record['type'];
  if (!isActivityEventType(type)) {
    throw new InvalidActivityEvent('type', `must be one of ${ACTIVITY_EVENT_TYPES.join(', ')}, got ${show(type)}`);
  }
  string(record, 'author');
  string(record, 'task');
  optionalString(record, 'project', '');
  const data = object(record['data'], 'data');
  string(data, 'source', 'data.');
  string(data, 'session', 'data.');

  switch (type) {
    case 'session.started':
      optionalBoolean(data, 'resumed');
      break;
    case 'session.ended':
      break;
    case 'turn.started':
      optionalString(data, 'agent');
      oneOf(data, 'origin', TURN_ORIGINS, true);
      break;
    case 'turn.ended':
      optionalString(data, 'agent');
      oneOf(data, 'outcome', TURN_OUTCOMES, false);
      break;
    case 'turn.awaiting-input':
      optionalString(data, 'agent');
      oneOf(data, 'reason', AWAITING_REASONS, false);
      break;
    case 'tool.started':
    case 'tool.used':
      optionalString(data, 'agent');
      optionalString(data, 'tool');
      optionalString(data, 'toolUseId');
      if (type === 'tool.used') {
        const duration = data['durationMs'];
        if (duration !== undefined && !(Number.isSafeInteger(duration) && (duration as number) >= 0)) {
          throw new InvalidActivityEvent('data.durationMs', `must be a non-negative integer, got ${show(duration)}`);
        }
        optionalBoolean(data, 'failed');
      }
      break;
    case 'agent.started':
      string(data, 'agent', 'data.');
      optionalString(data, 'parentAgent');
      optionalString(data, 'agentType');
      optionalBoolean(data, 'background');
      break;
    case 'agent.stopped':
      string(data, 'agent', 'data.');
      break;
  }
  return record as unknown as ActivityEvent;
}

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidActivityEvent(path, `must be an object, got ${show(value)}`);
  }
  return value as Json;
}

function number(record: Json, key: string): void {
  if (typeof record[key] !== 'number') {
    throw new InvalidActivityEvent(key, `must be a number, got ${show(record[key])}`);
  }
}

function string(record: Json, key: string, prefix = ''): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidActivityEvent(`${prefix}${key}`, `must be a non-empty string, got ${show(value)}`);
  }
  return value;
}

function optionalString(record: Json, key: string, prefix = 'data.'): void {
  if (record[key] !== undefined) {
    string(record, key, prefix);
  }
}

function optionalBoolean(record: Json, key: string): void {
  if (record[key] !== undefined && typeof record[key] !== 'boolean') {
    throw new InvalidActivityEvent(`data.${key}`, `must be true or false, got ${show(record[key])}`);
  }
}

function oneOf(record: Json, key: string, allowed: readonly string[], required: boolean): void {
  const value = record[key];
  if (value === undefined && !required) {
    return;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new InvalidActivityEvent(`data.${key}`, `must be one of ${allowed.join(', ')}, got ${show(value)}`);
  }
}

function show(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}
