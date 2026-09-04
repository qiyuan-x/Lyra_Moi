import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProviderRegistry,
  ProviderSettingsService,
  type FrostApiUsageInput,
  type ProviderDiscoveryInput
} from "@lyra/providers";
import {
  AppSettingsRepository,
  EnvironmentFileSecretStore,
  ProviderRepository,
  createRuntimeLayout,
  migrateRuntimeDatabase,
  openReadyRuntimeDatabase
} from "@lyra/storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("ProviderSettingsService", () => {
  it("stores multiple profiles and models without exposing API keys", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-providers-"));
    temporaryDirectories.push(parent);
    const layout = createRuntimeLayout(join(parent, "data"));
    await migrateRuntimeDatabase(layout);
    const database = await openReadyRuntimeDatabase(layout);
    const receivedDiscoveryInputs: ProviderDiscoveryInput[] = [];
    const registry = new ProviderRegistry().register({
      protocol: "openai",
      async discoverModels(input) {
        receivedDiscoveryInputs.push(input);
        return [
          { remoteModelId: "remote-model", displayName: "Remote model", metadata: {} }
        ];
      }
    });
    const secrets = new EnvironmentFileSecretStore(layout.environmentFile);
    const providers = new ProviderRepository(database);
    const service = new ProviderSettingsService({
      providers,
      settings: new AppSettingsRepository(database),
      secrets,
      registry
    });
    const secret = "provider-secret-value";

    try {
      const first = await service.createProfile({
        serviceType: "llm",
        name: "Main OpenAI",
        protocol: "openai",
        apiKey: secret
      });
      const second = await service.createProfile({
        serviceType: "llm",
        name: "Backup OpenAI",
        protocol: "openai",
        enabled: false
      });
      const compatible = await service.createProfile({
        serviceType: "image",
        name: "Local image API",
        protocol: "openai-compatible",
        baseUrl: "http://127.0.0.1:9000/v1/"
      });

      expect(first).toMatchObject({
        name: "Main OpenAI",
        baseUrl: "https://api.openai.com/v1",
        hasApiKey: true,
        apiKeyMask: "••••••••"
      });
      expect(second.hasApiKey).toBe(false);
      expect(compatible.baseUrl).toBe("http://127.0.0.1:9000/v1");
      const createdProfileIds = new Set([first.id, second.id, compatible.id]);
      expect(
        (await service.listProfiles()).filter((profile) => createdProfileIds.has(profile.id))
      ).toHaveLength(3);
      expect(JSON.stringify(first)).not.toContain(secret);
      expect(JSON.stringify(first)).not.toContain("apiKeyEnvironmentVariable");

      const databaseProfiles = database.connection
        .prepare("SELECT name, api_key_env FROM provider_profiles ORDER BY name")
        .all();
      expect(JSON.stringify(databaseProfiles)).not.toContain(secret);
      expect(await readFile(layout.environmentFile, "utf8")).toContain(secret);

      const updated = await service.updateProfile(first.id, { name: "Renamed OpenAI" });
      expect(updated).toMatchObject({ name: "Renamed OpenAI", hasApiKey: true });

      const firstLlm = service.createModel(first.id, {
        serviceType: "llm",
        remoteModelId: "llm-a",
        displayName: "LLM A",
        isDefault: true
      });
      expect(service.getApplicationDefaultModels().llm).toBe(firstLlm.id);
      const secondLlm = service.createModel(first.id, {
        serviceType: "llm",
        remoteModelId: "llm-b",
        displayName: "LLM B",
        isDefault: true,
        settings: { temperature: 0.5 }
      });
      expect(() => service.createModel(first.id, {
        serviceType: "image",
        remoteModelId: "invalid-image",
        displayName: "Invalid image"
      })).toThrow("scoped to service type llm");
      const imageModel = service.createModel(compatible.id, {
        serviceType: "image",
        remoteModelId: "image-a",
        displayName: "Image A",
        isDefault: true
      });
      const models = service.listModels(first.id);
      expect(models.find((model) => model.id === firstLlm.id)?.isDefault).toBe(false);
      expect(models.find((model) => model.id === secondLlm.id)?.isDefault).toBe(true);
      expect(service.listModels(compatible.id).find((model) => model.id === imageModel.id)?.isDefault).toBe(true);

      service.setApplicationDefaultModel("llm", secondLlm.id);
      service.setApplicationDefaultModel("image", imageModel.id);
      expect(service.getApplicationDefaultModels()).toEqual({
        llm: secondLlm.id,
        image: imageModel.id,
        model: null
      });
      service.updateModel(secondLlm.id, { enabled: false });
      expect(service.getApplicationDefaultModels().llm).toBeNull();
      service.deleteModel(firstLlm.id);
      expect(service.listModels(first.id).some((model) => model.id === firstLlm.id)).toBe(false);
      const restoredLlm = service.createModel(first.id, {
        serviceType: "llm",
        remoteModelId: "llm-a",
        displayName: "LLM A restored"
      });
      expect(restoredLlm.id).toBe(firstLlm.id);

      expect(await service.discoverModels(first.id)).toHaveLength(1);
      expect(receivedDiscoveryInputs[0]?.apiKey).toBe(secret);
      const connection = await service.testConnection(first.id);
      expect(connection.modelCount).toBe(1);
      expect(connection.models).toEqual([
        expect.objectContaining({ remoteModelId: "remote-model" })
      ]);
      expect(service.listModels(first.id, "llm")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ remoteModelId: "remote-model" })
        ])
      );
      expect(service.listModels(first.id, "llm")).toHaveLength(1);

      await service.updateProfile(first.id, { enabled: false });
      expect(service.getApplicationDefaultModels().image).toBe(imageModel.id);
      await service.updateProfile(first.id, { enabled: true });
      await service.updateProfile(second.id, { enabled: true });
      const enabledLlmProfiles = (await service.listProfiles())
        .filter((profile) => profile.serviceType === "llm" && profile.enabled);
      expect(enabledLlmProfiles.map((profile) => profile.id)).toEqual([first.id, second.id]);
      await service.deleteProfile(first.id);
      expect(
        (await service.listProfiles()).filter((profile) => createdProfileIds.has(profile.id))
      ).toHaveLength(2);
      expect(await secrets.has(providers.findProfile(first.id, true)!.apiKeyEnvironmentVariable)).toBe(
        false
      );
    } finally {
      database.close();
    }
  });

  it("supports explicit API key replacement and clearing", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-providers-"));
    temporaryDirectories.push(parent);
    const layout = createRuntimeLayout(join(parent, "data"));
    await migrateRuntimeDatabase(layout);
    const database = await openReadyRuntimeDatabase(layout);
    const service = new ProviderSettingsService({
      providers: new ProviderRepository(database),
      settings: new AppSettingsRepository(database),
      secrets: new EnvironmentFileSecretStore(layout.environmentFile),
      registry: new ProviderRegistry()
    });

    try {
      const profile = await service.createProfile({
        serviceType: "llm",
        name: "Gemini",
        protocol: "gemini",
        apiKey: "old-secret"
      });
      expect((await service.updateProfile(profile.id, { apiKey: "new-secret" })).hasApiKey).toBe(
        true
      );
      const cleared = await service.updateProfile(profile.id, { clearApiKey: true });
      expect(cleared.hasApiKey).toBe(false);
      expect(await readFile(layout.environmentFile, "utf8")).not.toContain("new-secret");
      const changedProtocol = await service.updateProfile(profile.id, {
        protocol: "openai-compatible",
        baseUrl: "https://api.deepseek.com/"
      });
      expect(changedProtocol).toMatchObject({
        protocol: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1"
      });
    } finally {
      database.close();
    }
  });

  it("queries FrostAPI usage with the saved provider credentials", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-providers-"));
    temporaryDirectories.push(parent);
    const layout = createRuntimeLayout(join(parent, "data"));
    await migrateRuntimeDatabase(layout);
    const database = await openReadyRuntimeDatabase(layout);
    const received: FrostApiUsageInput[] = [];
    const service = new ProviderSettingsService({
      providers: new ProviderRepository(database),
      settings: new AppSettingsRepository(database),
      secrets: new EnvironmentFileSecretStore(layout.environmentFile),
      registry: new ProviderRegistry(),
      frostApiUsage: {
        async query(input) {
          received.push(input);
          return {
            mode: "quota_limited",
            quota: { limit: 10, used: 3, remaining: 7, unit: "USD" }
          };
        }
      }
    });

    try {
      const frost = await service.createProfile({
        serviceType: "image",
        name: "FrostAPI 图像",
        protocol: "openai-compatible",
        baseUrl: "https://api.linfrsot.cloud",
        apiKey: "sk-saved",
        settings: { __lyra: { providerKind: "frostapi" } }
      });
      await expect(service.getFrostApiUsage(frost.id)).resolves.toEqual({
        mode: "quota_limited",
        quota: { limit: 10, used: 3, remaining: 7, unit: "USD" }
      });
      expect(received).toEqual([expect.objectContaining({
        baseUrl: "https://api.linfrsot.cloud/v1",
        apiKey: "sk-saved"
      })]);

      const other = await service.createProfile({
        serviceType: "llm",
        name: "Other",
        protocol: "openai-compatible",
        baseUrl: "https://other.test/v1",
        apiKey: "sk-other"
      });
      await expect(service.getFrostApiUsage(other.id))
        .rejects.toThrow("only supported for FrostAPI");
    } finally {
      database.close();
    }
  });
});
