import type { HookAdapters, HookSource } from '../../application/contracts/hook-adapter.js';

/** Hook sources by name: AI tools and sources of commits; separate from ToolAdapterRegistry, so the receiver loads no install code. */
export class HookAdapterRegistry implements HookAdapters {
  private readonly adapters: HookSource[] = [];

  register(adapter: HookSource): this {
    this.adapters.push(adapter);
    return this;
  }

  get(idOrAlias: string): HookSource | undefined {
    return this.adapters.find((adapter) => adapter.id === idOrAlias || adapter.aliases.includes(idOrAlias));
  }
}
