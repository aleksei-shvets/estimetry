import type { ToolAdapters } from '../../application/contracts/registries.js';
import type { ToolAdapter } from '../../application/contracts/tool-adapter.js';

/** AI tools estimetry can install into; a new tool is a new module and one `register` call in bootstrap. */
export class ToolAdapterRegistry implements ToolAdapters {
  private readonly adapters: ToolAdapter[] = [];

  register(adapter: ToolAdapter): this {
    const names = [adapter.id, ...adapter.aliases];
    if (names.some((name) => this.get(name))) {
      throw new Error(`tool ${adapter.id} is already registered`);
    }
    this.adapters.push(adapter);
    return this;
  }

  all(): readonly ToolAdapter[] {
    return this.adapters;
  }

  get(idOrAlias: string): ToolAdapter | undefined {
    return this.adapters.find((adapter) => adapter.id === idOrAlias || adapter.aliases.includes(idOrAlias));
  }
}
