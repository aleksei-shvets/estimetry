import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { HookAdapters } from '../contracts/hook-adapter.js';
import type { Clock } from '../ports/clock.js';
import type { CommitRecords } from './commit-records.js';
import type { HookCall } from './hook-call.js';
import type { ReceiveSessionHook } from './receive-session-hook.js';

/**
 * Entry point of installed hooks: checks the source and the event, then hands
 * the call to its kind of source — a commit, or a session of an AI tool.
 * Returns what the hook prints for the tool, if anything.
 */
export class ReceiveHook {
  constructor(
    private readonly adapters: HookAdapters,
    /** The moment the hook process started: the time of every event it writes. */
    private readonly clock: Clock,
    /** Commits named by sources of commits (the git hook). */
    private readonly commits: Pick<CommitRecords, 'record'>,
    private readonly sessions: Pick<ReceiveSessionHook, 'receive'>,
  ) {}

  async execute(call: HookCall): Promise<string | undefined> {
    const { source, event } = call;
    if (source === undefined || event === undefined) {
      throw new InvalidValue('hook needs a source and an event, e.g. `estimetry hook claude-code Stop`');
    }
    const adapter = this.adapters.get(source);
    if (adapter === undefined) {
      throw new InvalidValue(`unknown hook source "${source}"`);
    }
    if (!adapter.hookEvents.includes(event)) {
      throw new InvalidValue(`unknown ${source} hook event "${event}"`);
    }
    if (adapter.kind === 'commit') {
      this.commits.record(adapter, adapter.commitOf(event, call.payload), call.cwd, this.clock.now());
      return undefined;
    }
    return this.sessions.receive(adapter, event, call, this.clock.now());
  }
}
