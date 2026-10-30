import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { ToolAdapters } from '../contracts/registries.js';

/** The git hook `init --track-commits` installs. */
export const GIT_SOURCE = 'git';
const GIT_EVENTS: readonly string[] = ['post-commit'];

export interface HookCall {
  readonly source: string | undefined;
  readonly event: string | undefined;
  /** Raw stdin of the hook; translated into activity events with the hooks themselves. */
  readonly payload: string;
}

/**
 * Entry point of installed hooks. It must stay cheap: the hook of every tool
 * call goes through here, so it needs only the tool registry.
 */
export class ReceiveHook {
  constructor(private readonly tools: ToolAdapters) {}

  execute(call: HookCall): void {
    const { source, event } = call;
    if (source === undefined || event === undefined) {
      throw new InvalidValue('hook needs a source and an event, e.g. `estimetry hook claude-code Stop`');
    }
    const events = source === GIT_SOURCE ? GIT_EVENTS : this.tools.get(source)?.hookEvents;
    if (events === undefined) {
      throw new InvalidValue(`unknown hook source "${source}"`);
    }
    if (!events.includes(event)) {
      throw new InvalidValue(`unknown ${source} hook event "${event}"`);
    }
  }
}
