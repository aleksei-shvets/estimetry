import { describe, expect, it } from 'vitest';
import type { CardUsage } from '../../../src/domain/card/card.js';
import { usageRows } from '../../../src/interface/cli/presenters/text/closing-text.js';

const counts = { input: 1_000, output: 2_000, cacheRead: 3_000, cacheWrite5m: 0, cacheWrite1h: 0 };

describe('the usage of a task in text', () => {
  it('says by how many sessions the cost is counted when some tool reports none', () => {
    const usage: CardUsage = {
      tokens: { 'claude-opus-5-5': counts, 'gpt-x': { ...counts, cacheWrite: 400 } },
      costUSD: 6,
      approximate: false,
      sessions: 3,
      withLogs: 2,
      withCost: 1,
    };
    const rows = Object.fromEntries(usageRows(usage));
    expect(rows['cost']).toBe('$6.00, from the logs of 2 of 3 sessions, cost from 1 of 3 sessions');
    expect(rows['  gpt-x']).toMatch(/cache write 400$/);
  });

  it('is as before when every session with a log has a cost, and for a card written before withCost', () => {
    const usage: CardUsage = { tokens: {}, costUSD: 1.5, approximate: false, sessions: 1, withLogs: 1, withCost: 1 };
    expect(Object.fromEntries(usageRows(usage))['cost']).toBe('$1.50, from the logs of 1 of 1 sessions');
    const { withCost: _withCost, ...old } = usage;
    expect(Object.fromEntries(usageRows(old))['cost']).toBe('$1.50, from the logs of 1 of 1 sessions');
  });

  it('names no cost when no session has one', () => {
    const usage: CardUsage = { tokens: {}, costUSD: null, approximate: false, sessions: 1, withLogs: 1, withCost: 0 };
    expect(Object.fromEntries(usageRows(usage))['cost']).toBe('not reported, from the logs of 1 of 1 sessions, cost from 0 of 1 sessions');
  });
});
