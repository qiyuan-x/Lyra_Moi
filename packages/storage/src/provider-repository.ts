import { randomUUID } from "node:crypto";
import type {
  CreateProviderModelRequestBody,
  ProviderAdapterType,
  ProviderModelSnapshot,
  ProviderProtocol,
  ProviderServiceType,
  UpdateProviderModelRequestBody
} from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

interface ProviderProfileRow {
  id: string;
  service_type: ProviderServiceType;
  name: string;
  protocol: ProviderProtocol;
  base_url: string;
  api_key_env: string;
  secondary_api_key_env: string | null;
  adapter_type: ProviderAdapterType;
  settings_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ProviderModelRow {
  id: string;
  provider_profile_id: string;
  service_type: ProviderServiceType;
  remote_model_id: string;
  display_name: string;
  enabled: number;
  is_default: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface StoredProviderProfile {
  id: string;
  serviceType: ProviderServiceType;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnvironmentVariable: string;
  secondaryApiKeyEnvironmentVariable: string | null;
  adapterType: ProviderAdapterType;
  settings: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateStoredProviderProfileInput {
  id: string;
  serviceType: ProviderServiceType;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnvironmentVariable: string;
  secondaryApiKeyEnvironmentVariable?: string | null;
  adapterType?: ProviderAdapterType;
  settings?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateStoredProviderProfileInput {
  name?: string;
  protocol?: ProviderProtocol;
  baseUrl?: string;
  adapterType?: ProviderAdapterType;
  settings?: Record<string, unknown>;
  enabled?: boolean;
}

export class ProviderRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  createProfile(input: CreateStoredProviderProfileInput): StoredProviderProfile {
    const now = new Date().toISOString();
    const profile: StoredProviderProfile = {
      id: input.id,
      serviceType: input.serviceType,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      apiKeyEnvironmentVariable: input.apiKeyEnvironmentVariable,
      secondaryApiKeyEnvironmentVariable: input.secondaryApiKeyEnvironmentVariable ?? null,
      adapterType: input.adapterType ?? input.protocol,
      settings: structuredClone(input.settings ?? {}),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    return this.#database.transaction(() => {
      this.#database.connection
        .prepare(`
          INSERT INTO provider_profiles (
            id, service_type, name, protocol, adapter_type, base_url, api_key_env,
            secondary_api_key_env, settings_json, enabled,
            created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `)
        .run(
          profile.id,
          profile.serviceType,
          profile.name,
          profile.protocol,
          profile.adapterType,
          profile.baseUrl,
          profile.apiKeyEnvironmentVariable,
          profile.secondaryApiKeyEnvironmentVariable,
          JSON.stringify(profile.settings),
          profile.enabled ? 1 : 0,
          now,
          now
        );
      return structuredClone(profile);
    });
  }

  findProfile(profileId: string, includeDeleted = false): StoredProviderProfile | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, service_type, name, protocol, adapter_type, base_url, api_key_env,
               secondary_api_key_env, settings_json, enabled,
               created_at, updated_at, deleted_at
        FROM provider_profiles
        WHERE id = ? AND (? = 1 OR deleted_at IS NULL)
      `)
      .get(profileId, includeDeleted ? 1 : 0) as ProviderProfileRow | undefined;
    return row ? mapProfile(row) : null;
  }

  listProfiles(): StoredProviderProfile[] {
    const rows = this.#database.connection
      .prepare(`
        SELECT id, service_type, name, protocol, adapter_type, base_url, api_key_env,
               secondary_api_key_env, settings_json, enabled,
               created_at, updated_at, deleted_at
        FROM provider_profiles
        WHERE deleted_at IS NULL
        ORDER BY created_at, id
      `)
      .all() as unknown as ProviderProfileRow[];
    return rows.map(mapProfile);
  }

  updateProfile(
    profileId: string,
    input: UpdateStoredProviderProfileInput
  ): StoredProviderProfile {
    const existing = this.requireProfile(profileId);
    const updated: StoredProviderProfile = {
      ...existing,
      name: input.name ?? existing.name,
      protocol: input.protocol ?? existing.protocol,
      adapterType: input.adapterType ?? existing.adapterType,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      settings: structuredClone(input.settings ?? existing.settings),
      enabled: input.enabled ?? existing.enabled,
      updatedAt: new Date().toISOString()
    };
    return this.#database.transaction(() => {
      this.#database.connection
        .prepare(`
          UPDATE provider_profiles
          SET name = ?, protocol = ?, adapter_type = ?, base_url = ?,
              settings_json = ?, enabled = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
        `)
        .run(
          updated.name,
          updated.protocol,
          updated.adapterType,
          updated.baseUrl,
          JSON.stringify(updated.settings),
          updated.enabled ? 1 : 0,
          updated.updatedAt,
          profileId
        );
      return structuredClone(updated);
    });
  }

  softDeleteProfile(profileId: string): StoredProviderProfile {
    return this.#database.transaction(() => {
      const existing = this.requireProfile(profileId);
      const now = new Date().toISOString();
      this.#database.connection
        .prepare(`
          UPDATE provider_profiles
          SET enabled = 0, deleted_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
        `)
        .run(now, now, profileId);
      this.#database.connection
        .prepare(`
          UPDATE provider_models
          SET enabled = 0, is_default = 0, updated_at = ?
          WHERE provider_profile_id = ?
        `)
        .run(now, profileId);
      return { ...existing, enabled: false, updatedAt: now, deletedAt: now };
    });
  }

  createModel(
    profileId: string,
    input: CreateProviderModelRequestBody
  ): ProviderModelSnapshot {
    const profile = this.requireProfile(profileId);
    if (profile.serviceType !== input.serviceType) {
      throw new Error(`Provider profile is scoped to service type ${profile.serviceType}.`);
    }
    const deletedRow = this.#findDeletedModel(
      profileId,
      input.serviceType,
      input.remoteModelId
    );
    const enabled = input.enabled ?? true;
    const isDefault = input.isDefault ?? false;
    if (isDefault && !enabled) throw new Error("A default provider model must be enabled.");
    const now = new Date().toISOString();
    const model: ProviderModelSnapshot = {
      id: deletedRow?.id ?? randomUUID(),
      providerProfileId: profileId,
      serviceType: input.serviceType,
      remoteModelId: input.remoteModelId,
      displayName: input.displayName,
      enabled,
      isDefault,
      settings: structuredClone(input.settings ?? {}),
      createdAt: deletedRow?.created_at ?? now,
      updatedAt: now
    };

    return this.#database.transaction(() => {
      if (model.isDefault) this.#clearDefault(profileId, model.serviceType, now);
      if (deletedRow) {
        this.#database.connection
          .prepare(`
            UPDATE provider_models
            SET display_name = ?, enabled = ?, is_default = ?, settings_json = ?,
                updated_at = ?, deleted_at = NULL
            WHERE id = ? AND deleted_at IS NOT NULL
          `)
          .run(
            model.displayName,
            model.enabled ? 1 : 0,
            model.isDefault ? 1 : 0,
            JSON.stringify(model.settings),
            now,
            model.id
          );
      } else {
        this.#database.connection
          .prepare(`
            INSERT INTO provider_models (
              id, provider_profile_id, service_type, remote_model_id, display_name,
              enabled, is_default, settings_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            model.id,
            model.providerProfileId,
            model.serviceType,
            model.remoteModelId,
            model.displayName,
            model.enabled ? 1 : 0,
            model.isDefault ? 1 : 0,
            JSON.stringify(model.settings),
            now,
            now
          );
      }
      return structuredClone(model);
    });
  }

  findModel(modelId: string, includeDeleted = false): ProviderModelSnapshot | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, provider_profile_id, service_type, remote_model_id, display_name,
               enabled, is_default, settings_json, created_at, updated_at, deleted_at
        FROM provider_models
        WHERE id = ? AND (? = 1 OR deleted_at IS NULL)
      `)
      .get(modelId, includeDeleted ? 1 : 0) as ProviderModelRow | undefined;
    return row ? mapModel(row) : null;
  }

  listModels(
    profileId: string,
    serviceType?: ProviderServiceType
  ): ProviderModelSnapshot[] {
    const rows = serviceType
      ? (this.#database.connection
          .prepare(`
            SELECT id, provider_profile_id, service_type, remote_model_id, display_name,
                   enabled, is_default, settings_json, created_at, updated_at, deleted_at
            FROM provider_models
            WHERE provider_profile_id = ? AND service_type = ? AND deleted_at IS NULL
            ORDER BY created_at, id
          `)
          .all(profileId, serviceType) as unknown as ProviderModelRow[])
      : (this.#database.connection
          .prepare(`
            SELECT id, provider_profile_id, service_type, remote_model_id, display_name,
                   enabled, is_default, settings_json, created_at, updated_at, deleted_at
            FROM provider_models
            WHERE provider_profile_id = ? AND deleted_at IS NULL
            ORDER BY service_type, created_at, id
          `)
          .all(profileId) as unknown as ProviderModelRow[]);
    return rows.map(mapModel);
  }

  updateModel(modelId: string, input: UpdateProviderModelRequestBody): ProviderModelSnapshot {
    const existing = this.requireModel(modelId);
    const enabled = input.enabled ?? existing.enabled;
    const isDefault = input.isDefault ?? (enabled ? existing.isDefault : false);
    if (isDefault && !enabled) throw new Error("A default provider model must be enabled.");
    const updated: ProviderModelSnapshot = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      enabled,
      isDefault,
      settings: structuredClone(input.settings ?? existing.settings),
      updatedAt: new Date().toISOString()
    };

    return this.#database.transaction(() => {
      if (updated.isDefault) {
        this.#clearDefault(updated.providerProfileId, updated.serviceType, updated.updatedAt);
      }
      this.#database.connection
        .prepare(`
          UPDATE provider_models
          SET display_name = ?, enabled = ?, is_default = ?, settings_json = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
        `)
        .run(
          updated.displayName,
          updated.enabled ? 1 : 0,
          updated.isDefault ? 1 : 0,
          JSON.stringify(updated.settings),
          updated.updatedAt,
          modelId
        );
      return structuredClone(updated);
    });
  }

  requireProfile(profileId: string): StoredProviderProfile {
    const profile = this.findProfile(profileId);
    if (!profile) throw new Error(`Provider profile not found: ${profileId}`);
    return profile;
  }

  requireModel(modelId: string): ProviderModelSnapshot {
    const model = this.findModel(modelId);
    if (!model) throw new Error(`Provider model not found: ${modelId}`);
    return model;
  }

  softDeleteModel(modelId: string): ProviderModelSnapshot {
    const existing = this.requireModel(modelId);
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(`
        UPDATE provider_models
        SET enabled = 0, is_default = 0, deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `)
      .run(now, now, modelId);
    return {
      ...existing,
      enabled: false,
      isDefault: false,
      updatedAt: now
    };
  }

  #clearDefault(profileId: string, serviceType: ProviderServiceType, now: string): void {
    this.#database.connection
      .prepare(`
        UPDATE provider_models
        SET is_default = 0, updated_at = ?
        WHERE provider_profile_id = ? AND service_type = ? AND is_default = 1
      `)
      .run(now, profileId, serviceType);
  }

  #findDeletedModel(
    profileId: string,
    serviceType: ProviderServiceType,
    remoteModelId: string
  ): ProviderModelRow | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, provider_profile_id, service_type, remote_model_id, display_name,
               enabled, is_default, settings_json, created_at, updated_at, deleted_at
        FROM provider_models
        WHERE provider_profile_id = ? AND service_type = ? AND remote_model_id = ?
          AND deleted_at IS NOT NULL
      `)
      .get(profileId, serviceType, remoteModelId) as ProviderModelRow | undefined;
    return row ?? null;
  }

}

function mapProfile(row: ProviderProfileRow): StoredProviderProfile {
  const settings: unknown = JSON.parse(row.settings_json);
  if (!isRecord(settings)) throw new Error(`Provider profile settings are invalid: ${row.id}`);
  return {
    id: row.id,
    serviceType: row.service_type,
    name: row.name,
    protocol: row.protocol,
    adapterType: row.adapter_type,
    baseUrl: row.base_url,
    apiKeyEnvironmentVariable: row.api_key_env,
    secondaryApiKeyEnvironmentVariable: row.secondary_api_key_env,
    settings,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function mapModel(row: ProviderModelRow): ProviderModelSnapshot {
  const settings: unknown = JSON.parse(row.settings_json);
  if (!isRecord(settings)) throw new Error(`Provider model settings are invalid: ${row.id}`);
  return {
    id: row.id,
    providerProfileId: row.provider_profile_id,
    serviceType: row.service_type,
    remoteModelId: row.remote_model_id,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
