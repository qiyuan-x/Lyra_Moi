import { randomUUID } from "node:crypto";
import type {
  ApplicationDefaultModels,
  CreateProviderModelRequestBody,
  DiscoveredProviderModel,
  FrostApiUsageSnapshot,
  ProviderConnectionTestResult,
  ProviderAdapterType,
  ProviderModelSnapshot,
  ProviderProfileSnapshot,
  ProviderProtocol,
  ProviderServiceType,
  UpdateProviderModelRequestBody,
  UpdateProviderProfileRequestBody
} from "@lyra/contracts";
import {
  parseCreateProviderModelRequest,
  parseCreateProviderProfileRequest,
  parseUpdateProviderModelRequest,
  parseUpdateProviderProfileRequest
} from "@lyra/contracts";
import type {
  AppSettingsRepository,
  CreateStoredProviderProfileInput,
  ProviderRepository,
  SecretStore,
  StoredProviderProfile,
  UpdateStoredProviderProfileInput
} from "@lyra/storage";
import type { ProviderRegistry } from "./provider-registry.js";
import {
  FrostApiUsageClient,
  type FrostApiUsageReader
} from "./frostapi-usage.js";

const DEFAULT_BASE_URLS: Partial<Record<ProviderProtocol, string>> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta"
};

const APPLICATION_DEFAULT_KEYS: Record<ProviderServiceType, string> = {
  llm: "default_llm_model_id",
  image: "default_image_model_id",
  model: "default_model_provider_model_id"
};

export interface ProviderSettingsServiceOptions {
  providers: ProviderRepository;
  settings: AppSettingsRepository;
  secrets: SecretStore;
  registry: ProviderRegistry;
  frostApiUsage?: FrostApiUsageReader;
}

export class ProviderSettingsService {
  readonly #providers: ProviderRepository;
  readonly #settings: AppSettingsRepository;
  readonly #secrets: SecretStore;
  readonly #registry: ProviderRegistry;
  readonly #frostApiUsage: FrostApiUsageReader;

  constructor(options: ProviderSettingsServiceOptions) {
    this.#providers = options.providers;
    this.#settings = options.settings;
    this.#secrets = options.secrets;
    this.#registry = options.registry;
    this.#frostApiUsage = options.frostApiUsage ?? new FrostApiUsageClient();
  }

  async createProfile(value: unknown): Promise<ProviderProfileSnapshot> {
    const input = parseCreateProviderProfileRequest(value);
    const id = randomUUID();
    const apiKeyEnvironmentVariable = createApiKeyEnvironmentVariable(id);
    const secondaryApiKeyEnvironmentVariable =
      createSecondaryApiKeyEnvironmentVariable(id);
    validateAdapterServiceType(
      input.serviceType,
      input.adapterType ?? input.protocol
    );
    const profileInput: CreateStoredProviderProfileInput = {
      id,
      serviceType: input.serviceType,
      name: input.name.trim(),
      protocol: input.protocol,
      adapterType: input.adapterType ?? input.protocol,
      baseUrl: normalizeBaseUrl(
        input.protocol,
        input.baseUrl,
        input.serviceType,
        input.adapterType ?? input.protocol
      ),
      apiKeyEnvironmentVariable,
      secondaryApiKeyEnvironmentVariable,
      settings: structuredClone(input.settings ?? {})
    };
    if (input.enabled !== undefined) profileInput.enabled = input.enabled;

    if (input.apiKey !== undefined) {
      await this.#secrets.set(apiKeyEnvironmentVariable, input.apiKey.trim());
    }
    if (input.secondaryApiKey !== undefined) {
      await this.#secrets.set(
        secondaryApiKeyEnvironmentVariable,
        input.secondaryApiKey.trim()
      );
    }
    try {
      const profile = this.#providers.createProfile(profileInput);
      if (profile.enabled) this.#readDefaultModelId(profile.serviceType);
      return this.#toSnapshot(profile);
    } catch (error) {
      if (input.apiKey !== undefined) await this.#secrets.delete(apiKeyEnvironmentVariable);
      if (input.secondaryApiKey !== undefined) {
        await this.#secrets.delete(secondaryApiKeyEnvironmentVariable);
      }
      throw error;
    }
  }

  async getProfile(profileId: string): Promise<ProviderProfileSnapshot> {
    return this.#toSnapshot(this.#providers.requireProfile(profileId));
  }

  async listProfiles(): Promise<ProviderProfileSnapshot[]> {
    return Promise.all(this.#providers.listProfiles().map((profile) => this.#toSnapshot(profile)));
  }

  async updateProfile(
    profileId: string,
    value: unknown
  ): Promise<ProviderProfileSnapshot> {
    const input = parseUpdateProviderProfileRequest(value);
    const existing = this.#providers.requireProfile(profileId);
    const changesSecret = input.apiKey !== undefined || input.clearApiKey === true;
    const changesSecondarySecret =
      input.secondaryApiKey !== undefined || input.clearSecondaryApiKey === true;
    const previousSecret = changesSecret
      ? await this.#secrets.get(existing.apiKeyEnvironmentVariable)
      : null;
    const previousSecondarySecret = changesSecondarySecret
      ? await this.#readSecondarySecret(existing)
      : null;

    if (input.apiKey !== undefined) {
      await this.#secrets.set(existing.apiKeyEnvironmentVariable, input.apiKey.trim());
    } else if (input.clearApiKey === true) {
      await this.#secrets.delete(existing.apiKeyEnvironmentVariable);
    }
    if (input.secondaryApiKey !== undefined) {
      await this.#secrets.set(
        requireSecondarySecretEnvironmentVariable(existing),
        input.secondaryApiKey.trim()
      );
    } else if (input.clearSecondaryApiKey === true) {
      await this.#secrets.delete(requireSecondarySecretEnvironmentVariable(existing));
    }

    try {
      const repositoryInput: UpdateStoredProviderProfileInput = {};
      if (input.name !== undefined) repositoryInput.name = input.name.trim();
      const protocol = input.protocol ?? existing.protocol;
      const adapterType = input.adapterType ?? (
        input.protocol !== undefined && isProtocolAdapter(existing.adapterType)
          ? input.protocol
          : existing.adapterType
      );
      if (input.protocol !== undefined) repositoryInput.protocol = input.protocol;
      if (input.adapterType !== undefined || adapterType !== existing.adapterType) {
        repositoryInput.adapterType = adapterType;
      }
      validateAdapterServiceType(
        existing.serviceType,
        adapterType
      );
      if (input.settings !== undefined) {
        repositoryInput.settings = structuredClone(input.settings);
      }
      if (input.baseUrl !== undefined || input.protocol !== undefined) {
        repositoryInput.baseUrl = normalizeBaseUrl(
          protocol,
          input.baseUrl ?? existing.baseUrl,
          existing.serviceType,
          adapterType
        );
      }
      if (input.enabled !== undefined) repositoryInput.enabled = input.enabled;
      const updated = this.#providers.updateProfile(profileId, repositoryInput);
      if (!updated.enabled) this.#clearDefaultsForProfile(profileId);
      else this.#readDefaultModelId(updated.serviceType);
      return this.#toSnapshot(updated);
    } catch (error) {
      if (changesSecret) {
        await this.#restoreSecret(existing.apiKeyEnvironmentVariable, previousSecret);
      }
      if (changesSecondarySecret) {
        await this.#restoreSecret(
          requireSecondarySecretEnvironmentVariable(existing),
          previousSecondarySecret
        );
      }
      throw error;
    }
  }

  async deleteProfile(profileId: string): Promise<void> {
    const existing = this.#providers.requireProfile(profileId);
    const previousSecret = await this.#secrets.get(existing.apiKeyEnvironmentVariable);
    const previousSecondarySecret = await this.#readSecondarySecret(existing);
    await this.#secrets.delete(existing.apiKeyEnvironmentVariable);
    if (existing.secondaryApiKeyEnvironmentVariable) {
      await this.#secrets.delete(existing.secondaryApiKeyEnvironmentVariable);
    }
    try {
      this.#providers.softDeleteProfile(profileId);
      this.#clearDefaultsForProfile(profileId);
    } catch (error) {
      await this.#restoreSecret(existing.apiKeyEnvironmentVariable, previousSecret);
      if (existing.secondaryApiKeyEnvironmentVariable) {
        await this.#restoreSecret(
          existing.secondaryApiKeyEnvironmentVariable,
          previousSecondarySecret
        );
      }
      throw error;
    }
  }

  createModel(profileId: string, value: unknown): ProviderModelSnapshot {
    const input = parseCreateProviderModelRequest(value);
    const normalized: CreateProviderModelRequestBody = {
      serviceType: input.serviceType,
      remoteModelId: input.remoteModelId.trim(),
      displayName: input.displayName.trim()
    };
    if (input.enabled !== undefined) normalized.enabled = input.enabled;
    if (input.isDefault !== undefined) normalized.isDefault = input.isDefault;
    if (input.settings !== undefined) normalized.settings = structuredClone(input.settings);
    const created = this.#providers.createModel(profileId, normalized);
    const profile = this.#providers.requireProfile(profileId);
    if (profile.serviceType !== input.serviceType) {
      throw new Error(`Provider profile is scoped to service type ${profile.serviceType}.`);
    }
    if (created.enabled && profile.enabled && !this.#readDefaultModelId(created.serviceType)) {
      this.#settings.set(APPLICATION_DEFAULT_KEYS[created.serviceType], created.id);
    }
    return created;
  }

  updateModel(modelId: string, value: unknown): ProviderModelSnapshot {
    const input = parseUpdateProviderModelRequest(value);
    const normalized: UpdateProviderModelRequestBody = {};
    if (input.displayName !== undefined) normalized.displayName = input.displayName.trim();
    if (input.enabled !== undefined) normalized.enabled = input.enabled;
    if (input.isDefault !== undefined) normalized.isDefault = input.isDefault;
    if (input.settings !== undefined) normalized.settings = structuredClone(input.settings);
    const updated = this.#providers.updateModel(modelId, normalized);
    if (!updated.enabled) this.#clearApplicationDefaultIfMatches(updated.serviceType, modelId);
    return updated;
  }

  deleteModel(modelId: string): void {
    const deleted = this.#providers.softDeleteModel(modelId);
    this.#clearApplicationDefaultIfMatches(deleted.serviceType, modelId);
  }

  listModels(
    profileId: string,
    serviceType?: ProviderServiceType
  ): ProviderModelSnapshot[] {
    this.#providers.requireProfile(profileId);
    return this.#providers.listModels(profileId, serviceType);
  }

  async discoverModels(
    profileId: string,
    signal?: AbortSignal
  ): Promise<DiscoveredProviderModel[]> {
    const profile = this.#providers.requireProfile(profileId);
    const models = await this.#discoverRawModels(profile, signal);
    return filterDiscoveredModels(profile, models);
  }

  async testConnection(
    profileId: string,
    signal?: AbortSignal
  ): Promise<ProviderConnectionTestResult> {
    const startedAt = performance.now();
    const profile = this.#providers.requireProfile(profileId);
    const discovered = await this.#discoverRawModels(profile, signal);
    const models = filterDiscoveredModels(profile, discovered);
    this.#synchronizeDiscoveredModels(profileId, models, discovered);
    return {
      ok: true,
      modelCount: models.length,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      models
    };
  }

  async getFrostApiUsage(
    profileId: string,
    signal?: AbortSignal
  ): Promise<FrostApiUsageSnapshot> {
    const profile = this.#providers.requireProfile(profileId);
    if (!isFrostApiProfile(profile)) {
      throw new Error("Usage queries are only supported for FrostAPI providers.");
    }
    return this.#frostApiUsage.query({
      baseUrl: profile.baseUrl,
      apiKey: await this.#secrets.get(profile.apiKeyEnvironmentVariable),
      ...(signal ? { signal } : {})
    });
  }

  #synchronizeDiscoveredModels(
    profileId: string,
    models: readonly DiscoveredProviderModel[],
    discovered: readonly DiscoveredProviderModel[]
  ): void {
    const profile = this.#providers.requireProfile(profileId);
    const existing = this.#providers.listModels(profileId, profile.serviceType);
    const existingRemoteIds = new Set(existing.map((model) => model.remoteModelId));
    const discoveredIds = new Set(discovered.map((model) => model.remoteModelId));
    const acceptedIds = new Set(models.map((model) => model.remoteModelId));
    for (const model of existing) {
      // A successful /models response is authoritative for this provider.
      // Remove stale entries as well as models filtered out for this service.
      if (!discoveredIds.has(model.remoteModelId) || !acceptedIds.has(model.remoteModelId)) {
        this.deleteModel(model.id);
        existingRemoteIds.delete(model.remoteModelId);
      }
    }
    for (const model of models) {
      if (existingRemoteIds.has(model.remoteModelId)) continue;
      this.createModel(profileId, {
        serviceType: profile.serviceType,
        remoteModelId: model.remoteModelId,
        displayName: model.displayName,
        enabled: true
      });
      existingRemoteIds.add(model.remoteModelId);
    }
  }

  async #discoverRawModels(
    profile: StoredProviderProfile,
    signal?: AbortSignal
  ): Promise<DiscoveredProviderModel[]> {
    const apiKey = await this.#secrets.get(profile.apiKeyEnvironmentVariable);
    const secondaryApiKey = await this.#readSecondarySecret(profile);
    return this.#registry.discoverModels({ profile, apiKey, secondaryApiKey, signal });
  }

  setApplicationDefaultModel(
    serviceType: ProviderServiceType,
    modelId: string | null
  ): void {
    const settingKey = APPLICATION_DEFAULT_KEYS[serviceType];
    if (modelId === null) {
      this.#settings.delete(settingKey);
      return;
    }
    const model = this.#providers.requireModel(modelId);
    const profile = this.#providers.requireProfile(model.providerProfileId);
    if (model.serviceType !== serviceType) {
      throw new Error(`Provider model does not support service type ${serviceType}.`);
    }
    if (profile.serviceType !== serviceType) {
      throw new Error(`Provider profile does not support service type ${serviceType}.`);
    }
    if (!model.enabled || !profile.enabled) {
      throw new Error("Application default provider model must be enabled.");
    }
    this.#settings.set(settingKey, modelId);
  }

  getApplicationDefaultModels(): ApplicationDefaultModels {
    return {
      llm: this.#readDefaultModelId("llm"),
      image: this.#readDefaultModelId("image"),
      model: this.#readDefaultModelId("model")
    };
  }

  async #toSnapshot(profile: StoredProviderProfile): Promise<ProviderProfileSnapshot> {
    const hasApiKey = await this.#secrets.has(profile.apiKeyEnvironmentVariable);
    const hasSecondaryApiKey = profile.secondaryApiKeyEnvironmentVariable
      ? await this.#secrets.has(profile.secondaryApiKeyEnvironmentVariable)
      : false;
    return {
      id: profile.id,
      serviceType: profile.serviceType,
      name: profile.name,
      protocol: profile.protocol,
      adapterType: profile.adapterType,
      baseUrl: profile.baseUrl,
      settings: structuredClone(profile.settings),
      enabled: profile.enabled,
      hasApiKey,
      apiKeyMask: hasApiKey ? "••••••••" : null,
      hasSecondaryApiKey,
      secondaryApiKeyMask: hasSecondaryApiKey ? "••••••••" : null,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }

  async #restoreSecret(key: string, value: string | null): Promise<void> {
    if (value === null) await this.#secrets.delete(key);
    else await this.#secrets.set(key, value);
  }

  async #readSecondarySecret(profile: StoredProviderProfile): Promise<string | null> {
    return profile.secondaryApiKeyEnvironmentVariable
      ? this.#secrets.get(profile.secondaryApiKeyEnvironmentVariable)
      : null;
  }

  #readDefaultModelId(serviceType: ProviderServiceType): string | null {
    const settingKey = APPLICATION_DEFAULT_KEYS[serviceType];
    const value = this.#settings.get(settingKey);
    if (typeof value !== "string" || !value) return null;
    const model = this.#providers.findModel(value);
    const profile = model ? this.#providers.findProfile(model.providerProfileId) : null;
    if (
      !model ||
      !profile ||
      model.serviceType !== serviceType ||
      profile.serviceType !== serviceType ||
      !model.enabled ||
      !profile.enabled
    ) {
      this.#settings.delete(settingKey);
      return null;
    }
    return value;
  }

  #clearDefaultsForProfile(profileId: string): void {
    for (const serviceType of ["llm", "image", "model"] as const) {
      const modelId = this.#readDefaultModelId(serviceType);
      if (!modelId) continue;
      const model = this.#providers.findModel(modelId);
      if (model?.providerProfileId === profileId) {
        this.#settings.delete(APPLICATION_DEFAULT_KEYS[serviceType]);
      }
    }
  }

  #clearApplicationDefaultIfMatches(
    serviceType: ProviderServiceType,
    modelId: string
  ): void {
    if (this.#readDefaultModelId(serviceType) === modelId) {
      this.#settings.delete(APPLICATION_DEFAULT_KEYS[serviceType]);
    }
  }
}

export function normalizeBaseUrl(
  protocol: ProviderProtocol,
  value?: string,
  serviceType?: ProviderServiceType,
  adapterType?: ProviderAdapterType
): string {
  const source = value?.trim() || DEFAULT_BASE_URLS[protocol];
  if (!source) throw new Error("Base URL is required for an OpenAI-compatible provider.");
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Provider Base URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provider Base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Provider Base URL cannot contain credentials, query parameters, or fragments.");
  }
  if (
    protocol === "openai-compatible" &&
    (adapterType ?? protocol) === "openai-compatible" &&
    serviceType !== "model" &&
    url.pathname === "/"
  ) {
    url.pathname = "/v1";
  }
  return url.toString().replace(/\/+$/u, "");
}

export function createApiKeyEnvironmentVariable(profileId: string): string {
  return `LYRA_PROVIDER_${profileId.replaceAll("-", "_").toUpperCase()}_API_KEY`;
}

export function createSecondaryApiKeyEnvironmentVariable(profileId: string): string {
  return `LYRA_PROVIDER_${profileId.replaceAll("-", "_").toUpperCase()}_SECONDARY_API_KEY`;
}

function requireSecondarySecretEnvironmentVariable(profile: StoredProviderProfile): string {
  if (!profile.secondaryApiKeyEnvironmentVariable) {
    throw new Error("Provider secondary API key storage is not configured.");
  }
  return profile.secondaryApiKeyEnvironmentVariable;
}

function validateAdapterServiceType(
  serviceType: ProviderServiceType,
  adapterType: StoredProviderProfile["adapterType"]
): void {
  const modelAdapter =
    adapterType === "meshy" ||
    adapterType === "hunyuan" ||
    adapterType === "tripo" ||
    adapterType === "stability-3d" ||
    adapterType === "frostapi-3d";
  const supportsModel = modelAdapter;
  const imageAdapter =
    adapterType === "dashscope-image" ||
    adapterType === "seedream-image" ||
    adapterType === "zhipu-image" ||
    adapterType === "hunyuan-image" ||
    adapterType === "stability-image";
  if (serviceType === "model" && !supportsModel) {
    throw new Error("AI modeling requires a supported modeling adapter.");
  }
  if (serviceType !== "model" && modelAdapter) {
    throw new Error("AI modeling adapters can only be used in AI modeling settings.");
  }
  if (serviceType === "image" && adapterType === "anthropic") {
    throw new Error("Anthropic does not support image generation.");
  }
  if (serviceType !== "image" && imageAdapter) {
    throw new Error("Image generation adapters can only be used in AI image settings.");
  }
}

function isProtocolAdapter(
  adapterType: StoredProviderProfile["adapterType"]
): adapterType is ProviderProtocol {
  return adapterType === "openai" ||
    adapterType === "anthropic" ||
    adapterType === "gemini" ||
    adapterType === "openai-compatible";
}

function isFrostApiProfile(profile: StoredProviderProfile): boolean {
  if (profile.adapterType === "frostapi-3d") return true;
  const internal = profile.settings.__lyra;
  return Boolean(
    internal &&
    typeof internal === "object" &&
    !Array.isArray(internal) &&
    (internal as Record<string, unknown>).providerKind === "frostapi"
  );
}

export function filterDiscoveredModels(
  profile: Pick<StoredProviderProfile, "protocol" | "serviceType">,
  models: readonly DiscoveredProviderModel[]
): DiscoveredProviderModel[] {
  if (profile.serviceType === "model") return [...models];
  return models.filter((model) => {
    const imageModel = isImageGenerationModelId(model.remoteModelId, profile.protocol);
    return profile.serviceType === "image" ? imageModel : !imageModel;
  });
}

export function isImageGenerationModelId(
  remoteModelId: string,
  protocol: ProviderProtocol
): boolean {
  const id = remoteModelId.trim().toLowerCase().replace(/^models\//u, "");
  if (!id || /(embedding|moderation|rerank|vision-only)/u.test(id)) return false;
  if (protocol === "gemini") {
    return /^gemini-[a-z0-9.]+-[a-z0-9.-]*image(?:[-.]|$)/u.test(id) ||
      /^imagen(?:[-.]|$)/u.test(id);
  }
  return /(?:^|[-_.])(gpt-image|dall-e|imagen|imagegen|image-generation|nano-banana|flux|stable-image|stable-diffusion|sd3|sdxl|recraft|ideogram|midjourney|seedream|qwen-image|wan[0-9]|kolors|hidream|jimeng|cogview|glm-image|hunyuan-image)(?:[-_.]|$)/u.test(id) ||
    /^gemini-[a-z0-9.]+-[a-z0-9.-]*image(?:[-.]|$)/u.test(id) ||
    /(?:^|[-_.])image(?:[-_.]|$)/u.test(id);
}
