import type { DiscoveredProviderModel, ProviderAdapterType } from "@lyra/contracts";
import type { ProviderDiscoveryAdapter, ProviderDiscoveryInput } from "./provider-types.js";

export class ProviderRegistry {
  readonly #adapters = new Map<ProviderAdapterType, ProviderDiscoveryAdapter>();

  register(adapter: ProviderDiscoveryAdapter): this {
    const adapterType = adapter.adapterType ??
      (adapter as ProviderDiscoveryAdapter & { protocol?: ProviderAdapterType }).protocol;
    if (!adapterType) throw new Error("Provider adapter type is required.");
    if (this.#adapters.has(adapterType)) {
      throw new Error(`Provider adapter already registered: ${adapterType}`);
    }
    this.#adapters.set(adapterType, adapter);
    return this;
  }

  discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const adapterType = input.profile.adapterType ?? input.profile.protocol;
    const adapter = this.#adapters.get(adapterType);
    if (!adapter) {
      throw new Error(`Provider adapter is not registered: ${adapterType}`);
    }
    return adapter.discoverModels(input);
  }
}
