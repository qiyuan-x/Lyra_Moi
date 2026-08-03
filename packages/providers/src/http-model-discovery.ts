import type {
  DiscoveredProviderModel,
  ProviderProtocol
} from "@lyra/contracts";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import { ProviderRegistry } from "./provider-registry.js";
import type {
  FetchLike,
  ProviderDiscoveryAdapter,
  ProviderDiscoveryInput
} from "./provider-types.js";
import {
  HunyuanModelDiscoveryAdapter,
  MeshyModelDiscoveryAdapter,
  TripoModelDiscoveryAdapter
} from "./model-provider-discovery.js";

export interface HttpProviderRegistryOptions {
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
}

export function createHttpProviderRegistry(
  options: HttpProviderRegistryOptions = {}
): ProviderRegistry {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const client = new ProviderHttpClient({ fetchImplementation, timeoutMs, maxResponseBytes: 8 * 1024 * 1024 });
  return new ProviderRegistry()
    .register(new OpenAiModelDiscoveryAdapter("openai", true, client))
    .register(new OpenAiModelDiscoveryAdapter("openai-compatible", false, client))
    .register(new GeminiModelDiscoveryAdapter(client))
    .register(new MeshyModelDiscoveryAdapter(client))
    .register(new HunyuanModelDiscoveryAdapter(client))
    .register(new TripoModelDiscoveryAdapter(client));
}

class OpenAiModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly protocol: ProviderProtocol;
  readonly adapterType: ProviderProtocol;
  readonly #requiresApiKey: boolean;
  readonly #client: ProviderHttpClient;

  constructor(protocol: ProviderProtocol, requiresApiKey: boolean, client: ProviderHttpClient) {
    this.protocol = protocol;
    this.adapterType = protocol;
    this.#requiresApiKey = requiresApiKey;
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    if (this.#requiresApiKey && !input.apiKey) {
      throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
    let body: unknown;
    try {
      body = await this.#client.getJson(
        `${input.profile.baseUrl}/models`,
        headers,
        input.signal
      );
    } catch (error) {
      if (
        this.protocol === "openai-compatible" &&
        error instanceof ProviderConnectionError &&
        (error.code === "HTTP_ERROR" || error.code === "NOT_FOUND") &&
        (error.statusCode === 404 || error.statusCode === 405)
      ) {
        throw new ProviderConnectionError(
          "DISCOVERY_UNSUPPORTED",
          "Provider does not support model discovery.",
          error.statusCode
        );
      }
      throw error;
    }
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "Provider model list response is invalid."
      );
    }

    return uniqueAndSortModels(
      body.data.flatMap((value): DiscoveredProviderModel[] => {
        if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return [];
        const metadata: Record<string, unknown> = {};
        if (typeof value.owned_by === "string") metadata.ownedBy = value.owned_by;
        if (typeof value.created === "number") metadata.created = value.created;
        return [
          {
            remoteModelId: value.id,
            displayName: value.id,
            metadata
          }
        ];
      })
    );
  }
}

class GeminiModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly protocol = "gemini" as const;
  readonly adapterType = "gemini" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    if (!input.apiKey) {
      throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
    }
    const models: DiscoveredProviderModel[] = [];
    let pageToken: string | null = null;

    for (let page = 0; page < 20; page += 1) {
      const url = new URL(`${input.profile.baseUrl}/models`);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = await this.#client.getJson(
        url.toString(),
        { Accept: "application/json", "x-goog-api-key": input.apiKey },
        input.signal
      );
      if (!isRecord(body) || !Array.isArray(body.models)) {
        throw new ProviderConnectionError(
          "INVALID_RESPONSE",
          "Provider model list response is invalid."
        );
      }

      for (const value of body.models) {
        if (!isRecord(value) || typeof value.name !== "string") continue;
        const remoteModelId = value.name.startsWith("models/")
          ? value.name.slice("models/".length)
          : value.name;
        if (!remoteModelId) continue;
        const metadata: Record<string, unknown> = {};
        if (typeof value.description === "string") metadata.description = value.description;
        if (typeof value.inputTokenLimit === "number") {
          metadata.inputTokenLimit = value.inputTokenLimit;
        }
        if (typeof value.outputTokenLimit === "number") {
          metadata.outputTokenLimit = value.outputTokenLimit;
        }
        if (Array.isArray(value.supportedGenerationMethods)) {
          metadata.supportedGenerationMethods = value.supportedGenerationMethods.filter(
            (method): method is string => typeof method === "string"
          );
        }
        models.push({
          remoteModelId,
          displayName:
            typeof value.displayName === "string" && value.displayName.trim()
              ? value.displayName
              : remoteModelId,
          metadata
        });
      }

      pageToken = typeof body.nextPageToken === "string" && body.nextPageToken
        ? body.nextPageToken
        : null;
      if (!pageToken) return uniqueAndSortModels(models);
    }

    throw new ProviderConnectionError(
      "INVALID_RESPONSE",
      "Provider model list exceeded the pagination limit."
    );
  }
}

function uniqueAndSortModels(models: readonly DiscoveredProviderModel[]): DiscoveredProviderModel[] {
  const unique = new Map<string, DiscoveredProviderModel>();
  for (const model of models) {
    if (!unique.has(model.remoteModelId)) unique.set(model.remoteModelId, model);
  }
  return [...unique.values()].sort((left, right) =>
    left.remoteModelId.localeCompare(right.remoteModelId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
