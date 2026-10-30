import { describe, expect, it } from 'vitest';
import { ReceiveHook } from '../../../src/application/hooks/receive-hook.js';
import { InvalidValue } from '../../../src/domain/shared/domain-error.js';
import { FakeToolAdapter, ListRegistry } from '../../support/in-memory-files.js';

const receive = new ReceiveHook(new ListRegistry([new FakeToolAdapter()]));
const call = (source?: string, event?: string) => () => receive.execute({ source, event, payload: '{}' });

describe('ReceiveHook', () => {
  it('accepts the events of a registered tool, by id or alias, and the git post-commit', () => {
    expect(call('fake-tool', 'Stop')).not.toThrow();
    expect(call('fake', 'Stop')).not.toThrow();
    expect(call('git', 'post-commit')).not.toThrow();
  });

  it('rejects an unknown source or event and a call without arguments', () => {
    expect(call('cursor', 'Stop')).toThrow(/unknown hook source "cursor"/);
    expect(call('fake-tool', 'Teleport')).toThrow(InvalidValue);
    expect(call('git', 'pre-push')).toThrow(InvalidValue);
    expect(call()).toThrow(/needs a source and an event/);
  });
});
