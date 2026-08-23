import type { DiscoveredProviderModel } from "@lyra/contracts";
import { HunyuanImageApiClient } from "./hunyuan-image-provider.js";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import type { ProviderDiscoveryAdapter, ProviderDiscoveryInput } from "./provider-types.js";

export class DashScopeImageDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly adapterType = "dashscope-image" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const apiKey = requireApiKey(input.apiKey);
    const modelsUrl = new URL(input.profile.baseUrl);
    modelsUrl.pathname = "/compatible-mode/v1/models";
    modelsUrl.search = "";
    modelsUrl.hash = "";
    await this.#client.getJson(
      modelsUrl.toString(),
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      input.signal
    );
    return [
      discovered("qwen-image-3.0-pro", "Qwen Image 3.0 Pro"),
      discovered("qwen-image-2.0-pro", "Qwen Image 2.0 Pro"),
      discovered("wan2.7-image-pro", "Wan 2.7 Image Pro")
    ];
  }
}

export class HunyuanImageDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly adapterType = "hunyuan-image" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const api = new HunyuanImageApiClient({
      baseUrl: input.profile.baseUrl,
      secretId: input.apiKey,
      secretKey: input.secondaryApiKey,
      client: this.#client
    });
    try {
      await api.call("QueryHunyuanImageJob", { JobId: "0" }, input.signal);
    } catch (error) {
      if (
        error instanceof ProviderConnectionError &&
        error.code === "BAD_REQUEST"
      ) return [discovered("hunyuan-image", "腾讯混元生图")];
      throw error;
    }
    return [discovered("hunyuan-image", "腾讯混元生图")];
  }
}

export class StabilityImageDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly adapterType = "stability-image" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const apiKey = requireApiKey(input.apiKey);
    await this.#client.getJson(
      `${input.profile.baseUrl}/v1/user/account`,
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      input.signal
    );
    return [
      discovered("stable-image-ultra", "Stable Image Ultra"),
      discovered("stable-image-core", "Stable Image Core"),
      discovered("sd3.5-large", "Stable Diffusion 3.5 Large")
    ];
  }
}

function discovered(remoteModelId: string, displayName: string): DiscoveredProviderModel {
  return { remoteModelId, displayName, metadata: {} };
}

function requireApiKey(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
  }
  return normalized;
}
