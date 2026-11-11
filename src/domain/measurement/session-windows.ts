import type { Prepared } from './prepared-events.js';

/** A stretch in which the session served this task; open ends are infinite. */
export interface Window {
  readonly start: number;
  readonly end: number;
}

/**
 * Windows from `session.bound` and `session.unbound`. Without them the session
 * served the task all the time; an `unbound` with no `bound` before it closes a window open from the beginning.
 */
export function sessionWindows(items: readonly Prepared[]): Window[] | undefined {
  const marks = items.filter(({ event }) => event.type === 'session.bound' || event.type === 'session.unbound');
  if (marks.length === 0) {
    return undefined;
  }
  const windows: Window[] = [];
  let open: number | undefined = marks[0]?.event.type === 'session.unbound' ? -Infinity : undefined;
  for (const { event, at } of marks) {
    if (event.type === 'session.bound') {
      open ??= at;
    } else if (open !== undefined) {
      windows.push({ start: open, end: at });
      open = undefined;
    }
  }
  if (open !== undefined) {
    windows.push({ start: open, end: Infinity });
  }
  return windows;
}

/** Start of the window that holds `at`; the earliest time when the session has no windows or none holds it. */
export function windowStart(windows: readonly Window[] | undefined, at: number): number {
  if (windows === undefined) {
    return -Infinity;
  }
  return windows.find((window) => window.start <= at && at <= window.end)?.start ?? -Infinity;
}
