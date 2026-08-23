import type { DiscoveredProviderModel } from "@lyra/contracts";
import { HunyuanAi3dClient } from "./hunyuan-model-provider.js";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
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
    const api = new HunyuanAi3dClient({
      baseUrl: input.profile.baseUrl,
      apiKey,
      client: this.#client
    });
    let result: Record<string, unknown>;
    try {
      result = await api.query({ JobId: "0" }, input.signal);
    } catch (error) {
      if (
        error instanceof ProviderConnectionError &&
        (error.code === "BAD_REQUEST" || error.code === "NOT_FOUND")
      ) {
        return hunyuanModels();
      }
      throw error;
    }
    if (
      typeof result.ErrorCode === "string" &&
      /auth|credential|permission/iu.test(result.ErrorCode)
    ) {
      throw new ProviderConnectionError(
        "AUTHENTICATION_FAILED",
        result.ErrorMessage as string || "Tencent Cloud credential test failed."
      );
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
    discovered("3.1", "混元生 3D 3.1"),
    discovered("3.0", "混元生 3D 3.0")
  ];
}
