/*
 * Reading the session log of an AI tool (session-log-import spec). Only times,
 * offsets, models and token counts cross this contract: never texts of prompts,
 * answers, tool inputs or outputs, nor names or descriptions of subagents.
 */

import type { SessionLogFingerprint } from '../ports/log-import-state.js';

/** Tokens of one model that started within one five-minute bucket. Times are milliseconds since the epoch. */
export interface TokenBucketData {
  readonly at: number;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

/**
 * A turn of the main agent keyed by the byte offset of its first line. The
 * part before the first turn of a read has no start and no end: only tokens.
 */
export interface LogTurnData {
  readonly key: number;
  readonly start?: number;
  readonly end?: number;
  readonly tokens: readonly TokenBucketData[];
}

/** A subagent by the id of its log file: stretches of its records (for its end) and its tokens. */
export interface LogAgentData {
  readonly agent: string;
  readonly spans: readonly (readonly [number, number])[];
  readonly tokens: readonly TokenBucketData[];
}

/** The running total of the tool process that started at `startTime`. */
export interface CostTotalData {
  readonly startTime: number;
  readonly totalUSD: number;
  readonly unknown: boolean;
}

export interface SessionLogRead {
  readonly status: 'read';
  /** Byte offset the read started at. */
  readonly from: number;
  /** Where the next read starts: the first line of the last turn, open or closed. */
  readonly next: number;
  readonly turns: readonly LogTurnData[];
  /** Every subagent file of the session; the importer keeps those that changed. */
  readonly agents: readonly LogAgentData[];
  readonly cost: readonly CostTotalData[];
  /** Lines that are not JSON or records of an unknown type. */
  readonly skipped: number;
  readonly fingerprint: SessionLogFingerprint;
}

export type SessionLogResult =
  | SessionLogRead
  | { readonly status: 'not-found' }
  /** The log has no records at all: a session opened and closed. */
  | { readonly status: 'no-data'; readonly fingerprint: SessionLogFingerprint }
  /** Records, but none the reader recognizes. */
  | { readonly status: 'unrecognized'; readonly fingerprint: SessionLogFingerprint }
  | { readonly status: 'over-budget' };

export interface SessionLogRequest {
  readonly session: string;
  /** The path the hook reported, if any; otherwise the reader searches the tool's own folders. */
  readonly path?: string;
  /** Byte offset in the main file to read from. */
  readonly from: number;
  /** Milliseconds the read may take; it stops with `over-budget` past them. */
  readonly budgetMs?: number;
}

/** The log of one session of one AI tool. */
export interface SessionLogReader {
  /** Tool id, the same as the `source` of the tool's activity events. */
  readonly id: string;
  /** Size and time of the files, without reading them; undefined when there is no log. */
  fingerprint(session: string, path?: string): SessionLogFingerprint | undefined;
  /** @throws only SessionLogFailure, whose message carries a code and no content of the log. */
  read(request: SessionLogRequest): SessionLogResult;
}

export interface SessionLogReaders {
  get(id: string): SessionLogReader | undefined;
}

/** A failure to read a log; the message is a code, safe for the error log. */
export class SessionLogFailure extends Error {
  constructor(readonly code: string) {
    super(`session log: ${code}`);
    this.name = 'SessionLogFailure';
    this.stack = this.message; // nothing but the code reaches the error log
  }
}
