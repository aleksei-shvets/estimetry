import { describe, expect, it } from 'vitest';
import { activityUntil, type ActivityEvent } from '../../../src/domain/measurement/activity-events.js';
import { Duration } from '../../../src/domain/measurement/duration.js';
import { ManualTime, manualKnownBy } from '../../../src/domain/measurement/manual-time.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);
const manual = (description: string, end?: string) =>
  ManualTime.of({ kind: 'user', duration: Duration.ofMinutes(10), description, ...(end === undefined ? {} : { at: at(end) }) });

describe('what a task knew by a moment', () => {
  it('manual time recorded by then and, when it has a moment, ended by then', () => {
    const records = [
      { manual: manual('before, ended before', '09:30'), recordedAt: at('09:40') },
      { manual: manual('before, untimed'), recordedAt: at('09:50') },
      { manual: manual('before, ends later', '10:30'), recordedAt: at('09:55') },
      { manual: manual('recorded later', '09:00'), recordedAt: at('10:05') },
      { manual: manual('from an old snapshot, untimed') },
      { manual: manual('exactly then', '10:00'), recordedAt: at('10:00') },
    ];
    expect(manualKnownBy(records, at('10:00')).map((m) => m.description)).toEqual([
      'before, ended before',
      'before, untimed',
      'from an old snapshot, untimed',
      'exactly then',
    ]);
  });

  it('activity up to the moment, the moment itself included', () => {
    const event = (ts: string, id: string) => ({ ts: at(ts).toISOString(), id }) as unknown as ActivityEvent;
    const events = [event('09:00', 'a'), event('10:00', 'b'), event('10:01', 'c')];
    expect(activityUntil(events, at('10:00')).map((e) => e.id)).toEqual(['a', 'b']);
  });
});
