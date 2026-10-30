import type { Flow } from '../../application/contracts/flow.js';
import type { Flows } from '../../application/contracts/registries.js';

/** Development processes; the last registered one is the fallback when none is detected. */
export class FlowRegistry implements Flows {
  private readonly flows: Flow[] = [];

  register(flow: Flow): this {
    if (this.get(flow.id)) {
      throw new Error(`flow ${flow.id} is already registered`);
    }
    this.flows.push(flow);
    return this;
  }

  all(): readonly Flow[] {
    return this.flows;
  }

  get(id: string): Flow | undefined {
    return this.flows.find((flow) => flow.id === id);
  }
}
