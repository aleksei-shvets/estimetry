import type { Timestamp } from '../../domain/shared/timestamp.js';
import { InvalidValue } from '../../domain/shared/domain-error.js';
import type { HookAdapter } from '../contracts/hook-adapter.js';
import type { ProjectLocator } from '../ports/project-locator.js';
import type { ActivityRecorder } from './activity-recorder.js';
import type { HookCall } from './hook-call.js';
import type { PromptContext } from './prompt-context.js';
import type { SessionEndImport } from './session-end-import.js';
import type { SessionStartContext } from './session-start-context.js';
import type { SessionTask } from './session-task.js';

/**
 * A hook of an AI tool's session: the call becomes activity of the session's
 * task, then its kind decides what follows — the context of a session start or
 * a prompt, or the import of the log at the session end.
 */
export class ReceiveSessionHook {
  constructor(
    private readonly locator: ProjectLocator,
    private readonly sessionTask: SessionTask,
    private readonly recorder: Pick<ActivityRecorder, 'record'>,
    private readonly start: Pick<SessionStartContext, 'text'>,
    private readonly prompt: Pick<PromptContext, 'text'>,
    private readonly end: Pick<SessionEndImport, 'run'>,
  ) {}

  /** What the hook prints for the tool, if anything. */
  async receive(adapter: HookAdapter, event: string, call: HookCall, now: Timestamp): Promise<string | undefined> {
    let payload: unknown;
    try {
      payload = JSON.parse(call.payload);
    } catch {
      throw new InvalidValue(`${adapter.id} ${event}: stdin is not JSON`); // its content is never repeated
    }
    const translation = adapter.translate(event, payload);
    const located = this.locator.locate(call.projectDir ?? translation.cwd ?? call.cwd);
    const resolved = this.sessionTask.resolve(translation.session, located, translation.kind, now);
    if (resolved === undefined) {
      return undefined; // not an estimetry project
    }
    this.recorder.record(adapter.id, translation, resolved, now);
    switch (translation.kind) {
      case 'session-start':
        return adapter.renderContext(event, await this.start.text(translation.session, resolved, now));
      case 'session-end':
        await this.end.run(adapter.id, translation.session, translation.transcript);
        return undefined;
      case 'prompt': {
        const text = await this.prompt.text(translation.session, resolved, now);
        return text === undefined ? undefined : adapter.renderContext(event, text);
      }
      default:
        return undefined;
    }
  }
}
