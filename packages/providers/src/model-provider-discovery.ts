import type { DiscoveredProviderModel } from "@lyra/contracts";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import {
  HUNYUAN_LEGACY_BASE_URL,
  HUNYUAN_TOKENHUB_BASE_URL,
  HunyuanAi3dClient,
  type HunyuanApiVariant
} from "./hunyuan-model-provider.js";
import {
  requireRecord,
  requireText
} from "./model-provider-types.js";
import type {
  ProviderDiscoveryAdapter,
  ProviderDiscoveryInput
} from "./provider-types.js";

export class MeshyModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly adapterType = "meshy" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const apiKey = requireText(input.apiKey, "Meshy API key is required.");
    await this.#client.getJson(
      `${input.profile.baseUrl}/openapi/v1/image-to-3d?page_num=1&page_size=1`,
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      input.signal
    );
    return [
      discovered("latest", "Meshy Latest"),
      discovered("meshy-7", "Meshy 7"),
      discovered("meshy-6", "Meshy 6"),
      discovered("meshy-5", "Meshy 5"),
      discovered("meshy-t2", "Meshy Smart Topology T2"),
      discovered("meshy-t1", "Meshy Smart Topology T1")
    ];
  }
}

export class TripoModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly adapterType = "tripo" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const apiKey = requireText(input.apiKey, "Tripo API key is required.");
    const response = requireRecord(await this.#client.getJson(
      `${input.profile.baseUrl}/user/balance`,
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      input.signal
    ));
    if (response.code !== 0) {
      throw new ProviderConnectionError("AUTHENTICATION_FAILED", "Tripo connection test failed.");
    }
    return [
      discovered("P1-20260311", "Tripo P1"),
      discovered("Turbo-v1.0-20250506", "Tripo Turbo"),
      discovered("v3.1-20260211", "Tripo v3.1"),
      discovered("v3.0-20250812", "Tripo v3.0"),
      discovered("v2.5-20250123", "Tripo v2.5")
    ];
  }
}

export class HunyuanModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly adapterType = "hunyuan" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const apiKey = requireText(input.apiKey, "Hunyuan API key is required.");
    const endpoints = resolveHunyuanDiscoveryEndpoints(input.profile.baseUrl);
    let firstError: unknown;
    for (const variant of variantOrder(endpoints.preferredVariant)) {
      try {
        return variant === "tokenhub"
          ? await this.#discoverTokenHubModels(endpoints.tokenhubBaseUrl, apiKey, input.signal)
          : await this.#discoverLegacyModels(endpoints.legacyBaseUrl, apiKey, input.signal);
      } catch (error) {
        firstError ??= error;
      }
    }
    throw firstError ?? new ProviderConnectionError(
      "UNREACHABLE",
      "Hunyuan provider could not be reached."
    );
  }

  async #discoverTokenHubModels(
    baseUrl: string,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<DiscoveredProviderModel[]> {
    const normalized = baseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, "");
    const result = requireRecord(await this.#client.getJson(
      `${normalized}/v1/models`,
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal
    ));
    if (!Array.isArray(result.data)) {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "TokenHub model list response is invalid."
      );
    }
    const available = new Set(result.data.flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== "string") return [];
      return [value.id.trim().toLowerCase()];
    }));
    return hunyuanModels().filter((model) => available.has(model.remoteModelId));
  }

  async #discoverLegacyModels(
    baseUrl: string,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<DiscoveredProviderModel[]> {
    const client = new HunyuanAi3dClient({
      baseUrl,
      apiKey,
      variant: "legacy",
      client: this.#client
    });
    try {
      await client.query({ JobId: "lyra-connection-test" }, signal);
    } catch (error) {
      if (
        error instanceof ProviderConnectionError &&
        (error.code === "BAD_REQUEST" || error.code === "NOT_FOUND")
      ) {
        return hunyuanModels();
      }
      throw error;
    }
    return hunyuanModels();
  }
}

export class StabilityModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly adapterType = "stability-3d" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    const apiKey = requireText(input.apiKey, "Stability API key is required.");
    await this.#client.getJson(
      `${input.profile.baseUrl}/v1/user/account`,
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      input.signal
    );
    return [
      discovered("spar3d", "Stable Point Aware 3D"),
      discovered("stable-fast-3d", "Stable Fast 3D")
    ];
  }
}

function discovered(remoteModelId: string, displayName: string): DiscoveredProviderModel {
  return { remoteModelId, displayName, metadata: {} };
}

function hunyuanModels(): DiscoveredProviderModel[] {
  return [
    discovered("hy-3d-3.1", "混元生 3D 3.1"),
    discovered("hy-3d-3.0", "混元生 3D 3.0")
  ];
}

function resolveHunyuanDiscoveryEndpoints(baseUrl: string): {
  preferredVariant: HunyuanApiVariant;
  tokenhubBaseUrl: string;
  legacyBaseUrl: string;
} {
  const configured = requireText(baseUrl, "Hunyuan Base URL is required.");
  const url = new URL(configured);
  const normalized = (
    url.hostname.toLowerCase() === new URL(HUNYUAN_LEGACY_BASE_URL).hostname ||
    url.hostname.toLowerCase() === new URL(HUNYUAN_TOKENHUB_BASE_URL).hostname
  )
    ? url.origin
    : url.toString().replace(/\/+$/u, "");
  if (url.hostname.toLowerCase() === new URL(HUNYUAN_LEGACY_BASE_URL).hostname) {
    return {
      preferredVariant: "legacy",
      tokenhubBaseUrl: HUNYUAN_TOKENHUB_BASE_URL,
      legacyBaseUrl: normalized
    };
  }
  return {
    preferredVariant: "tokenhub",
    tokenhubBaseUrl: normalized,
    legacyBaseUrl: HUNYUAN_LEGACY_BASE_URL
  };
}

function variantOrder(preferred: HunyuanApiVariant): HunyuanApiVariant[] {
  return preferred === "tokenhub"
    ? ["tokenhub", "legacy"]
    : ["legacy", "tokenhub"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
