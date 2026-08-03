import type { EntityId, UtcDateTime } from "./common.js";

export type ProviderProtocol = "openai" | "gemini" | "openai-compatible";
export type ProviderAdapterType =
  | ProviderProtocol
  | "meshy"
  | "tripo"
  | "hunyuan";
export type ProviderServiceType = "llm" | "image" | "model";

export interface ProviderProfileSnapshot {
  id: EntityId;
  serviceType: ProviderServiceType;
  name: string;
  protocol: ProviderProtocol;
  adapterType: ProviderAdapterType;
  baseUrl: string;
  settings: Record<string, unknown>;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  hasSecondaryApiKey: boolean;
  secondaryApiKeyMask: string | null;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

export interface ProviderModelSnapshot {
  id: EntityId;
  providerProfileId: EntityId;
  serviceType: ProviderServiceType;
  remoteModelId: string;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  settings: Record<string, unknown>;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

export interface CreateProviderProfileRequestBody {
  serviceType: ProviderServiceType;
  name: string;
  protocol: ProviderProtocol;
  adapterType?: ProviderAdapterType;
  baseUrl?: string;
  settings?: Record<string, unknown>;
  apiKey?: string;
  secondaryApiKey?: string;
  enabled?: boolean;
}

export interface UpdateProviderProfileRequestBody {
  name?: string;
  protocol?: ProviderProtocol;
  adapterType?: ProviderAdapterType;
  baseUrl?: string;
  settings?: Record<string, unknown>;
  enabled?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
  secondaryApiKey?: string;
  clearSecondaryApiKey?: boolean;
}

export interface CreateProviderModelRequestBody {
  serviceType: ProviderServiceType;
  remoteModelId: string;
  displayName: string;
  enabled?: boolean;
  isDefault?: boolean;
  settings?: Record<string, unknown>;
}

export interface UpdateProviderModelRequestBody {
  displayName?: string;
  enabled?: boolean;
  isDefault?: boolean;
  settings?: Record<string, unknown>;
}

export interface DiscoveredProviderModel {
  remoteModelId: string;
  displayName: string;
  metadata: Record<string, unknown>;
}

export interface ProviderConnectionTestResult {
  ok: true;
  modelCount: number;
  elapsedMs: number;
  models: DiscoveredProviderModel[];
}

export interface ApplicationDefaultModels {
  llm: EntityId | null;
  image: EntityId | null;
  model: EntityId | null;
}
