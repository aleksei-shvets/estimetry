import { describe, expect, it } from 'vitest';
import { EventMetaSource } from '../../../src/application/shared/event-meta-source.js';
import { Timestamp } from '../../../src/domain/shared/timestamp.js';
import { FakeAuthorProvider, SequentialIdGenerator } from '../../support/fakes.js';

const at = (hhmm: string) => Timestamp.parse(`2026-10-27T${hhmm}:00.000Z`);

describe('metadata of a record at a known moment', () => {
  it('takes the moment given, not the clock, and the next id', () => {
    const meta = new EventMetaSource({ now: () => at('23:00') }, new SequentialIdGenerator(), new FakeAuthorProvider());
    const first = meta.at(at('10:00'));
    expect(first.at.toISOString()).toBe(at('10:00').toISOString());
    expect(meta.next().id).not.toBe(first.id);
  });
});
