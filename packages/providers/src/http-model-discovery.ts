import { systemProxyFetch } from "./system-proxy.js";
import { antigravityHeaders, antigravityProject, isAntigravityOAuth } from "./antigravity-client.js";
import type {
  DiscoveredProviderModel,
  ProviderAdapterType,
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
  StabilityModelDiscoveryAdapter,
  TripoModelDiscoveryAdapter
} from "./model-provider-discovery.js";
import {
  DashScopeImageDiscoveryAdapter,
  HunyuanImageDiscoveryAdapter,
  StabilityImageDiscoveryAdapter
} from "./image-provider-discovery.js";

export interface HttpProviderRegistryOptions {
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
}

export function createHttpProviderRegistry(
  options: HttpProviderRegistryOptions = {}
): ProviderRegistry {
  const fetchImplementation = options.fetchImplementation ?? systemProxyFetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const client = new ProviderHttpClient({ fetchImplementation, timeoutMs, maxResponseBytes: 8 * 1024 * 1024 });
  return new ProviderRegistry()
    .register(new OpenAiModelDiscoveryAdapter("openai", true, client))
    .register(new OpenAiModelDiscoveryAdapter("openai-compatible", false, client))
    .register(new OpenAiModelDiscoveryAdapter("openai-compatible", true, client, "frostapi-3d"))
    .register(new OpenAiModelDiscoveryAdapter("openai-compatible", true, client, "seedream-image"))
    .register(new OpenAiModelDiscoveryAdapter("openai-compatible", true, client, "zhipu-image"))
    .register(new AnthropicModelDiscoveryAdapter(client))
    .register(new GeminiModelDiscoveryAdapter(client))
    .register(new DashScopeImageDiscoveryAdapter(client))
    .register(new HunyuanImageDiscoveryAdapter(client))
    .register(new StabilityImageDiscoveryAdapter(client))
    .register(new MeshyModelDiscoveryAdapter(client))
    .register(new HunyuanModelDiscoveryAdapter(client))
    .register(new StabilityModelDiscoveryAdapter(client))
    .register(new TripoModelDiscoveryAdapter(client));
}

class AnthropicModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly protocol = "anthropic" as const;
  readonly adapterType = "anthropic" as const;
  readonly #client: ProviderHttpClient;

  constructor(client: ProviderHttpClient) {
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    if (!input.apiKey) {
      throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
    }
    const oauth = isImportedCredential(input.profile);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(oauth
        ? { Authorization: `Bearer ${input.apiKey}`, "anthropic-beta": "oauth-2025-04-20" }
        : { "x-api-key": input.apiKey }),
      "anthropic-version": "2023-06-01"
    };
    const body = await this.#client.getJson(
      `${input.profile.baseUrl}/models`,
      headers,
      input.signal
    );
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "Provider model list response is invalid."
      );
    }
    return uniqueAndSortModels(body.data.flatMap((value): DiscoveredProviderModel[] => {
      if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return [];
      return [{
        remoteModelId: value.id,
        displayName: typeof value.display_name === "string" && value.display_name.trim()
          ? value.display_name
          : value.id,
        metadata: {}
      }];
    }));
  }
}

class OpenAiModelDiscoveryAdapter implements ProviderDiscoveryAdapter {
  readonly protocol: ProviderProtocol;
  readonly adapterType: ProviderAdapterType;
  readonly #requiresApiKey: boolean;
  readonly #client: ProviderHttpClient;

  constructor(
    protocol: ProviderProtocol,
    requiresApiKey: boolean,
    client: ProviderHttpClient,
    adapterType: ProviderAdapterType = protocol
  ) {
    this.protocol = protocol;
    this.adapterType = adapterType;
    this.#requiresApiKey = requiresApiKey;
    this.#client = client;
  }

  async discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    if ((this.#requiresApiKey || input.profile.serviceType === "model") && !input.apiKey) {
      throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
    }
    // Codex OAuth credentials are not OpenAI API keys.  The public
    // api.openai.com/v1/models endpoint rejects them, while the Codex
    // subscription exposes its model manifest through ChatGPT's backend.
    // Keep API-key discovery unchanged and use the same account binding as
    // the usage endpoint for imported OAuth/token credentials.
    if (input.profile.serviceType === "llm" &&
        isImportedCredential(input.profile) &&
        isOfficialOpenAiApi(input.profile.baseUrl)) {
      return this.#discoverCodexModels(input);
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
    let body: unknown;
    try {
      const baseUrl = input.profile.serviceType === "model" &&
        new URL(input.profile.baseUrl).pathname === "/"
        ? `${input.profile.baseUrl}/v1`
        : input.profile.baseUrl;
      body = await this.#client.getJson(
        `${baseUrl}/models`,
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

  async #discoverCodexModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]> {
    // Keep query version and client headers aligned, as in sub2api's
    // openai_codex_models_service.go and openai_codex_identity.go.
    const clientVersion = "0.146.0";
    const settings = input.profile.settings;
    const accountId = typeof settings.credentialAccountId === "string"
      ? settings.credentialAccountId.trim()
      : "";
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      Originator: "codex-tui",
      "User-Agent": `codex-tui/${clientVersion} (Ubuntu 22.4.0; x86_64) xterm-256color`,
      Version: clientVersion
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
    const body = await this.#client.getJson(
      `https://chatgpt.com/backend-api/codex/models?client_version=${clientVersion}`,
      headers,
      input.signal
    );
    if (!isRecord(body) || !Array.isArray(body.models)) {
      throw new ProviderConnectionError("INVALID_RESPONSE", "Codex 模型清单响应格式无效。");
    }
    const models = uniqueAndSortModels(body.models.flatMap((value): DiscoveredProviderModel[] => {
      if (!isRecord(value)) return [];
      const remoteModelId = typeof value.slug === "string" && value.slug.trim()
        ? value.slug.trim()
        : typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
      if (!remoteModelId) return [];
      const displayName = typeof value.display_name === "string" && value.display_name.trim()
        ? value.display_name.trim()
        : typeof value.displayName === "string" && value.displayName.trim()
          ? value.displayName.trim()
          : remoteModelId;
      return [{ remoteModelId, displayName, metadata: value }];
    }));
    if (!models.length) {
      throw new ProviderConnectionError("INVALID_RESPONSE", body.models.length
        ? "Codex 模型清单中没有可识别的模型 ID，已有模型未修改。"
        : "Codex 上游返回空模型列表，无法确认模型可用性；已有模型未修改。请检查账号权限或重新授权后重试。");
    }
    return models;
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
    if (isAntigravityOAuth(input.profile.settings)) {
      const base = input.profile.baseUrl.replace(/\/+$/u, "");
      const project = await antigravityProject(this.#client, base, input.apiKey, input.signal, input.profile.settings.gcpProjectId);
      const body = await this.#client.postJson(`${base}/v1internal:fetchAvailableModels`, antigravityHeaders(input.apiKey), { project }, input.signal);
      if (!isRecord(body) || !isRecord(body.models)) throw new Error("Antigravity 模型列表格式无效。");
      return Object.entries(body.models).flatMap(([id, value]) => {
        if (!isRecord(value)) return [];
        return [{ remoteModelId: id, displayName: typeof value.displayName === "string" ? value.displayName : id, metadata: {} }];
      });
    }
    let pageToken: string | null = null;

    for (let page = 0; page < 20; page += 1) {
      const url = new URL(`${input.profile.baseUrl}/models`);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = await this.#client.getJson(
        url.toString(),
        isImportedCredential(input.profile)
          ? { Accept: "application/json", Authorization: `Bearer ${input.apiKey}` }
          : { Accept: "application/json", "x-goog-api-key": input.apiKey },
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

function isImportedCredential(profile: ProviderDiscoveryInput["profile"]): boolean {
  return ["oauth", "token", "json"].includes(String(profile.settings.authMode));
}

function isOfficialOpenAiApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).origin === "https://api.openai.com";
  } catch {
    return false;
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
