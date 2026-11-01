import type { HookAdapter, HookAdapters } from '../../application/contracts/hook-adapter.js';

/** Hook translators by tool; separate from ToolAdapterRegistry, so the receiver loads no install code. */
export class HookAdapterRegistry implements HookAdapters {
  private readonly adapters: HookAdapter[] = [];

  register(adapter: HookAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  get(idOrAlias: string): HookAdapter | undefined {
    return this.adapters.find((adapter) => adapter.id === idOrAlias || adapter.aliases.includes(idOrAlias));
  }
}
