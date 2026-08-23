import type { LlmProvider } from "@lyra/agent-engine";
import type { AssetService, BinaryImageProvider } from "@lyra/core";
import type {
  ProviderRepository,
  SecretStore,
  StoredProviderProfile
} from "@lyra/storage";
import type {
  ProviderAdapterType,
  ProviderModelSnapshot,
  ProviderProtocol,
  ProviderServiceType
} from "@lyra/contracts";
import { AnthropicLlmProvider } from "./anthropic-llm-provider.js";
import { GeminiImageProvider } from "./gemini-image-provider.js";
import { GeminiInteractionsLlmProvider } from "./gemini-llm-provider.js";
import { DashScopeImageProvider } from "./dashscope-image-provider.js";
import { HunyuanImageProvider } from "./hunyuan-image-provider.js";
import { HunyuanModelProvider } from "./hunyuan-model-provider.js";
import type { ProviderAssetLoader } from "./image-provider-types.js";
import { MeshyModelProvider } from "./meshy-model-provider.js";
import type {
  BinaryModelProvider,
  ModelProviderAssetLoader
} from "./model-provider-types.js";
import { OpenAiImageProvider } from "./openai-image-provider.js";
import type { OpenAiImageProviderOptions } from "./openai-image-provider.js";
import {
  OpenAiCompatibleLlmProvider,
  OpenAiResponsesLlmProvider
} from "./openai-llm-provider.js";
import type { OpenAiLlmProviderOptions } from "./openai-llm-provider.js";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import { StabilityImageProvider } from "./stability-image-provider.js";
import { StabilityModelProvider } from "./stability-model-provider.js";
import { TripoModelProvider } from "./tripo-model-provider.js";
import { OpenAiCompatibleModelProvider } from "./openai-compatible-model-provider.js";

type RuntimeLlmProviderOptions = OpenAiLlmProviderOptions;
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

const llmProviderFactories: Record<
  ProviderProtocol,
  (options: RuntimeLlmProviderOptions) => LlmProvider
> = {
  openai: (options) => new OpenAiResponsesLlmProvider(options),
  anthropic: (options) => new AnthropicLlmProvider(options),
  gemini: (options) => new GeminiInteractionsLlmProvider(options),
  "openai-compatible": (options) => new OpenAiCompatibleLlmProvider(options)
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
  "openai-compatible": (options) => new OpenAiCompatibleModelProvider(options)
};

export interface RuntimeProviderFactoryOptions {
  providers: ProviderRepository;
  secrets: SecretStore;
  assets: AssetService;
  llmClient?: ProviderHttpClient;
  imageClient?: ProviderHttpClient;
  modelClient?: ProviderHttpClient;
  client?: ProviderHttpClient;
}

export class RuntimeProviderFactory {
  readonly #providers: ProviderRepository;
  readonly #secrets: SecretStore;
  readonly #assetLoader: ProviderAssetLoader;
  readonly #modelAssetLoader: ModelProviderAssetLoader;
  readonly #llmClient: ProviderHttpClient;
  readonly #imageClient: ProviderHttpClient;
  readonly #modelClient: ProviderHttpClient;

  constructor(options: RuntimeProviderFactoryOptions) {
    this.#providers = options.providers;
    this.#secrets = options.secrets;
    this.#assetLoader = new AssetServiceLoader(options.assets);
    this.#modelAssetLoader = new AssetServiceLoader(options.assets);
    this.#llmClient = options.llmClient ?? options.client ?? new ProviderHttpClient();
    this.#imageClient = options.imageClient
      ?? options.client
      ?? new ProviderHttpClient({ timeoutMs: 10 * 60_000 });
    this.#modelClient = options.modelClient
      ?? options.client
      ?? new ProviderHttpClient({
        timeoutMs: 2 * 60_000,
        maxResponseBytes: 300 * 1024 * 1024
      });
  }

  async createLlmProvider(profileId: string, modelId: string): Promise<LlmProvider> {
    const resolved = await this.#resolve(profileId, modelId, "llm");
    const options = {
      baseUrl: resolved.profile.baseUrl,
      apiKey: resolved.apiKey,
      secondaryApiKey: resolved.secondaryApiKey,
      model: resolved.model.remoteModelId,
      settings: resolved.model.settings,
      client: this.#llmClient
    };
    return llmProviderFactories[resolved.profile.protocol](options);
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

export class RuntimeLlmProviderResolver {
  readonly #factory: RuntimeProviderFactory;

  constructor(factory: RuntimeProviderFactory) {
    this.#factory = factory;
  }

  resolve(providerProfileId: string, providerModelId: string): Promise<LlmProvider> {
    return this.#factory.createLlmProvider(providerProfileId, providerModelId);
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

class AssetServiceLoader implements ProviderAssetLoader, ModelProviderAssetLoader {
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

function requireSecret(value: string | null, label: string): string {
  if (!value?.trim()) {
    throw new ProviderConnectionError("MISSING_API_KEY", `${label} is not configured.`);
  }
  return value.trim();
}
