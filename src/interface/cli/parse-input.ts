import { Duration } from '../../domain/measurement/duration.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import { Timestamp } from '../../domain/shared/timestamp.js';
import { TaskId } from '../../domain/task/task-id.js';

/*
 * Conversion of command-line strings into value objects, at the boundary,
 * before anything reaches the application.
 */

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** `2026-10-27T12:00:00Z` (ISO 8601) or `2026-10-27 12:00` in local time. */
export function parseTime(text: string): Timestamp {
  const trimmed = text.trim();
  const local = LOCAL_TIME.exec(trimmed);
  if (local) {
    const [year, month, day, hour, minute] = local.slice(1).map(Number) as [number, number, number, number, number];
    const date = new Date(year, month - 1, day, hour, minute);
    // Date rolls 2026-02-30 over to March; refuse instead.
    if (date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute) {
      return Timestamp.fromMillis(date.getTime());
    }
  } else if (ISO_TIME.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) {
    return Timestamp.parse(trimmed);
  }
  throw new InvalidValue(`invalid time "${text}", expected ISO 8601 (2026-10-27T12:00:00Z) or "YYYY-MM-DD HH:MM" in local time`);
}

export function parseDuration(text: string): Duration {
  return Duration.parse(text);
}

/** A whole number ≥ `min` for options like `--agents` and `--lines`. */
export function parseCount(text: string, option: string, min: number): number {
  const value = Number(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < min) {
    throw new InvalidValue(`${option} must be a whole number of at least ${min}, got "${text}"`);
  }
  return value;
}

export function parseTaskOption(text: string | undefined): { task?: TaskId } {
  return text === undefined ? {} : { task: TaskId.parse(text) };
}

/** A number greater than zero, like the preliminary hours of `emt similar --hours`. */
export function parsePositive(text: string, option: string): number {
  const value = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(value) || value <= 0) {
    throw new InvalidValue(`${option} must be a number greater than 0, got "${text}"`);
  }
  return value;
}

/** Comma-separated labels of a stack: `flutter,bloc`. */
export function parseLabels(text: string): string[] {
  return text.split(',').map((label) => label.trim()).filter((label) => label !== '');
}

