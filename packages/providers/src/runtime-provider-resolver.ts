import type { ModelClient } from "@lyra/agent-runtime";
import { HttpAgentModelClient } from "./agent-model-client.js";
import { AgentModelTransport } from "./agent-model-transport.js";
import type { AssetService, BinaryImageProvider } from "@lyra/core";
import type {
  ProviderRepository,
  SecretStore,
  StoredProviderProfile
} from "@lyra/storage";
import type {
  ProviderAdapterType,
  ProviderModelSnapshot,
  ProviderServiceType
} from "@lyra/contracts";
import { GeminiImageProvider } from "./gemini-image-provider.js";
import { DashScopeImageProvider } from "./dashscope-image-provider.js";
import { HunyuanImageProvider } from "./hunyuan-image-provider.js";
import { HunyuanModelProvider } from "./hunyuan-model-provider.js";
import type { ProviderAssetLoader } from "./image-provider-types.js";
import type { AgentAssetLoader } from "./agent-model-codec.js";
import { MeshyModelProvider } from "./meshy-model-provider.js";
import type {
  BinaryModelProvider,
  ModelProviderAssetLoader
} from "./model-provider-types.js";
import { OpenAiImageProvider } from "./openai-image-provider.js";
import type { OpenAiImageProviderOptions } from "./openai-image-provider.js";
import { ProviderConnectionError } from "./provider-errors.js";
import {
  createImageProviderHttpClient,
  ProviderHttpClient
} from "./provider-http-client.js";
import { StabilityImageProvider } from "./stability-image-provider.js";
import { StabilityModelProvider } from "./stability-model-provider.js";
import { TripoModelProvider } from "./tripo-model-provider.js";
import { FrostApiModelProvider } from "./frostapi-model-provider.js";

type RuntimeImageProviderOptions = OpenAiImageProviderOptions & {
  secondaryApiKey: string | null;
};
type RuntimeModelProviderOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  assetLoader: ModelProviderAssetLoader;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
};


const imageProviderFactories: Partial<Record<
  ProviderAdapterType,
  (options: RuntimeImageProviderOptions) => BinaryImageProvider
>> = {
  openai: (options) => new OpenAiImageProvider(options),
  gemini: (options) => new GeminiImageProvider(options),
  "openai-compatible": (options) => new OpenAiImageProvider({ ...options, compatible: true }),
  "dashscope-image": (options) => new DashScopeImageProvider(options),
  "seedream-image": (options) => new OpenAiImageProvider({
    ...options,
    compatible: true,
    generationReferenceField: "image"
  }),
  "zhipu-image": (options) => new OpenAiImageProvider({ ...options, compatible: true }),
  "hunyuan-image": (options) => new HunyuanImageProvider(options),
  "stability-image": (options) => new StabilityImageProvider(options)
};

const modelProviderFactories: Partial<Record<
  ProviderAdapterType,
  (options: RuntimeModelProviderOptions) => BinaryModelProvider
>> = {
  meshy: (options) => new MeshyModelProvider(options),
  tripo: (options) => new TripoModelProvider(options),
  hunyuan: (options) => new HunyuanModelProvider(options),
  "stability-3d": (options) => new StabilityModelProvider(options),
  "frostapi-3d": (options) => new FrostApiModelProvider(options)
};

export interface RuntimeProviderFactoryOptions {
  agentTransport?: AgentModelTransport;
  providers: ProviderRepository;
  secrets: SecretStore;
  assets: AssetService;
  imageClient?: ProviderHttpClient;
  modelClient?: ProviderHttpClient;
  client?: ProviderHttpClient;
}

export class RuntimeProviderFactory {
  readonly #agentTransport: AgentModelTransport;
  readonly #providers: ProviderRepository;
  readonly #secrets: SecretStore;
  readonly #assetLoader: ProviderAssetLoader;
  readonly #modelAssetLoader: ModelProviderAssetLoader;
  readonly #llmAssetLoader: AgentAssetLoader;
  readonly #imageClient: ProviderHttpClient;
  readonly #modelClient: ProviderHttpClient;

  constructor(options: RuntimeProviderFactoryOptions) {
    this.#agentTransport = options.agentTransport ?? new AgentModelTransport();
    this.#providers = options.providers;
    this.#secrets = options.secrets;
    const assetLoader = new AssetServiceLoader(options.assets);
    this.#assetLoader = assetLoader;
    this.#modelAssetLoader = assetLoader;
    this.#llmAssetLoader = assetLoader;
    this.#imageClient = options.imageClient
      ?? options.client
      ?? createImageProviderHttpClient();
    this.#modelClient = options.modelClient
      ?? options.client
      ?? new ProviderHttpClient({
        timeoutMs: 2 * 60_000,
        maxResponseBytes: 300 * 1024 * 1024
      });
  }

  async createAgentModel(profileId: string, modelId: string): Promise<ModelClient> {
    const resolved = await this.#resolve(profileId, modelId, "llm");
    return new HttpAgentModelClient({
      protocol: resolved.profile.protocol, baseUrl: agentBaseUrl(resolved.profile),
      apiKey: resolved.apiKey, model: resolved.model.remoteModelId,
      settings: resolved.model.settings, assetLoader: this.#llmAssetLoader, transport: this.#agentTransport,
      headers: importedCredentialHeaders(resolved.profile.settings, resolved.apiKey)
    });
  }

  async createImageProvider(
    profileId: string,
    modelId: string
  ): Promise<BinaryImageProvider> {
    const resolved = await this.#resolve(profileId, modelId, "image");
    const options = {
      baseUrl: resolved.profile.baseUrl,
      apiKey: resolved.apiKey,
      secondaryApiKey: resolved.secondaryApiKey,
      model: resolved.model.remoteModelId,
      assetLoader: this.#assetLoader,
      settings: resolved.model.settings,
      client: this.#imageClient
    };
    const factory = imageProviderFactories[resolved.profile.adapterType];
    if (!factory) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        `Provider adapter does not support image generation: ${resolved.profile.adapterType}.`
      );
    }
    return factory(options);
  }

  async createModelProvider(
    profileId: string,
    modelId: string
  ): Promise<BinaryModelProvider> {
    const resolved = await this.#resolve(profileId, modelId, "model");
    const common = {
      baseUrl: resolved.profile.baseUrl,
      model: resolved.model.remoteModelId,
      assetLoader: this.#modelAssetLoader,
      settings: resolved.model.settings,
      client: this.#modelClient
    };
    const factory = modelProviderFactories[resolved.profile.adapterType];
    if (!factory) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        `Provider adapter does not support model generation: ${resolved.profile.adapterType}.`
      );
    }
    return factory({
      ...common,
      apiKey: requireSecret(resolved.apiKey, `${resolved.profile.adapterType} API key`)
    });
  }

  async #resolve(
    profileId: string,
    modelId: string,
    serviceType: ProviderServiceType
  ): Promise<{
    profile: StoredProviderProfile;
    model: ProviderModelSnapshot;
    apiKey: string | null;
    secondaryApiKey: string | null;
  }> {
    const profile = this.#providers.requireProfile(profileId);
    const model = this.#providers.requireModel(modelId);
    if (!profile.enabled || !model.enabled) {
      throw new ProviderConnectionError("INVALID_CONFIGURATION", "Provider profile and model must be enabled.");
    }
    if (model.providerProfileId !== profile.id) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        "Provider model does not belong to the selected profile."
      );
    }
    if (model.serviceType !== serviceType) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        `Provider model does not support service type ${serviceType}.`
      );
    }
    if (profile.serviceType !== serviceType) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        `Provider profile does not support service type ${serviceType}.`
      );
    }
    const apiKey = await this.#secrets.get(profile.apiKeyEnvironmentVariable);
    const secondaryApiKey = profile.secondaryApiKeyEnvironmentVariable
      ? await this.#secrets.get(profile.secondaryApiKeyEnvironmentVariable)
      : null;
    const permitsAnonymous = profile.adapterType === "openai-compatible";
    if (!permitsAnonymous && !apiKey) {
      throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
    }
    if (profile.adapterType === "hunyuan-image" && !secondaryApiKey) {
      throw new ProviderConnectionError("MISSING_API_KEY", "Tencent Cloud SecretKey is not configured.");
    }
    return { profile, model, apiKey, secondaryApiKey };
  }
}

export class RuntimeImageProviderResolver {
  readonly #factory: RuntimeProviderFactory;

  constructor(factory: RuntimeProviderFactory) {
    this.#factory = factory;
  }

  resolve(providerProfileId: string, providerModelId: string): Promise<BinaryImageProvider> {
    return this.#factory.createImageProvider(providerProfileId, providerModelId);
  }
}

export class RuntimeModelProviderResolver {
  readonly #factory: RuntimeProviderFactory;

  constructor(factory: RuntimeProviderFactory) {
    this.#factory = factory;
  }

  resolve(providerProfileId: string, providerModelId: string): Promise<BinaryModelProvider> {
    return this.#factory.createModelProvider(providerProfileId, providerModelId);
  }
}

class AssetServiceLoader implements
  ProviderAssetLoader,
  ModelProviderAssetLoader,
  AgentAssetLoader {
  readonly #assets: AssetService;

  constructor(assets: AssetService) {
    this.#assets = assets;
  }

  async loadImage(assetId: string, projectId: string) {
    const content = await this.#assets.getContent(assetId);
    if (content.descriptor.asset.projectId !== projectId) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        "Reference asset does not belong to the generation project."
      );
    }
    if (content.descriptor.asset.kind !== "image") {
      throw new ProviderConnectionError("INVALID_CONFIGURATION", "Reference asset is not an image.");
    }
    return {
      data: content.data,
      mimeType: content.descriptor.mimeType,
      name: createAttachmentName(content.descriptor.asset.name, content.descriptor.mimeType)
    };
  }

  async loadAsset(assetId: string, projectId: string) {
    const content = await this.#assets.getContent(assetId);
    if (content.descriptor.asset.projectId !== projectId) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        "Attachment does not belong to the conversation project."
      );
    }
    return {
      data: content.data,
      mimeType: content.descriptor.mimeType,
      name: content.descriptor.asset.name
    };
  }

  loadModelInput(assetId: string, projectId: string) {
    return this.#assets.getModelInputImage(assetId, projectId);
  }
}

function createAttachmentName(name: string, mimeType: string): string {
  const safeName = name.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "image";
  if (/\.[A-Za-z0-9]{2,5}$/u.test(safeName)) return safeName;
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  return `${safeName}.${extension}`;
}

export function importedCredentialHeaders(settings: Record<string, unknown>, token: string | null): Record<string, string> {
  if (!token || !["oauth", "token", "json"].includes(String(settings.authMode))) return {};
  return {
    Authorization: `Bearer ${token}`,
    ...(typeof settings.credentialAccountId === "string" && settings.credentialAccountId.trim()
      ? { "ChatGPT-Account-Id": settings.credentialAccountId.trim() }
      : {}),
    ...(settings.authMode === "oauth" ? { "anthropic-beta": "oauth-2025-04-20" } : {})
  };
}

export function agentBaseUrl(profile: StoredProviderProfile): string {
  if (profile.protocol === "openai" && ["oauth", "token", "json"].includes(String(profile.settings.authMode))) {
    try {
      if (new URL(profile.baseUrl).origin === "https://api.openai.com") {
        return "https://chatgpt.com/backend-api/codex";
      }
    } catch { /* Base URL validation is handled by the profile service. */ }
  }
  return profile.baseUrl;
}

function requireSecret(value: string | null, label: string): string {
  if (!value?.trim()) {
    throw new ProviderConnectionError("MISSING_API_KEY", `${label} is not configured.`);
  }
  return value.trim();
}
