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
    const response = await this.#client.getJson(
      modelsUrl.toString(),
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      input.signal
    );
    if (!response || typeof response !== "object" || !Array.isArray((response as { data?: unknown }).data)) {
      throw new ProviderConnectionError("INVALID_RESPONSE", "DashScope 模型列表响应格式无效。");
    }
    const models = ((response as { data: unknown[] }).data).flatMap((item): DiscoveredProviderModel[] => {
      if (!item || typeof item !== "object") return [];
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" && id.trim() ? [discovered(id.trim(), id.trim())] : [];
    });
    if (!models.length) throw new ProviderConnectionError("DISCOVERY_UNSUPPORTED", "DashScope 上游未返回模型，请手动添加模型。");
    return models;
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
      ) throw new ProviderConnectionError("DISCOVERY_UNSUPPORTED", "腾讯混元生图未提供模型列表，请手动添加模型。");
      throw error;
    }
    throw new ProviderConnectionError("DISCOVERY_UNSUPPORTED", "腾讯混元生图未提供模型列表，请手动添加模型。");
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
    throw new ProviderConnectionError("DISCOVERY_UNSUPPORTED", "Stability 生图接口未提供可用的模型列表，请手动添加模型。");
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
