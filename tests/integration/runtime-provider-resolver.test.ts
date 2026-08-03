import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetService } from "@lyra/core";
import {
  GeminiImageProvider,
  GeminiInteractionsLlmProvider,
  OpenAiCompatibleLlmProvider,
  OpenAiImageProvider,
  OpenAiResponsesLlmProvider,
  RuntimeProviderFactory
} from "@lyra/providers";
import {
  AssetRepository,
  EnvironmentFileSecretStore,
  ImmutableBlobStore,
  ProjectRepository,
  ProviderRepository,
  SharpImageProcessor,
  ThumbnailStore,
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

describe("RuntimeProviderFactory", () => {
  it("resolves enabled models by protocol and service type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-runtime-provider-"));
    temporaryDirectories.push(directory);
    const layout = createRuntimeLayout(join(directory, "data"));
    await migrateRuntimeDatabase(layout);
    const database = await openReadyRuntimeDatabase(layout);
    try {
      new ProjectRepository(database).ensureDefaultProject();
      const providers = new ProviderRepository(database);
      const secrets = new EnvironmentFileSecretStore(layout.environmentFile);
      const assets = new AssetService({
        assets: new AssetRepository(database),
        blobs: new ImmutableBlobStore(layout.projects, layout.blobs),
        thumbnails: new ThumbnailStore(layout.projects, layout.thumbnails),
        images: new SharpImageProcessor()
      });
      const openai = providers.createProfile({
        id: "profile-openai",
        serviceType: "llm",
        name: "OpenAI",
        protocol: "openai",
        baseUrl: "https://api.openai.test/v1",
        apiKeyEnvironmentVariable: "LYRA_TEST_OPENAI_KEY"
      });
      await secrets.set(openai.apiKeyEnvironmentVariable, "secret");
      const openaiLlm = providers.createModel(openai.id, {
        serviceType: "llm",
        remoteModelId: "llm-openai",
        displayName: "LLM"
      });
      const openaiImageProfile = providers.createProfile({
        id: "profile-openai-image",
        serviceType: "image",
        name: "OpenAI Image",
        protocol: "openai",
        baseUrl: "https://api.openai.test/v1",
        apiKeyEnvironmentVariable: "LYRA_TEST_OPENAI_IMAGE_KEY"
      });
      await secrets.set(openaiImageProfile.apiKeyEnvironmentVariable, "image-secret");
      const openaiImage = providers.createModel(openaiImageProfile.id, {
        serviceType: "image",
        remoteModelId: "image-openai",
        displayName: "Image"
      });
      const compatible = providers.createProfile({
        id: "profile-compatible",
        serviceType: "llm",
        name: "Local",
        protocol: "openai-compatible",
        baseUrl: "http://127.0.0.1:9000/v1",
        apiKeyEnvironmentVariable: "LYRA_TEST_LOCAL_KEY",
        enabled: false
      });
      const compatibleLlm = providers.createModel(compatible.id, {
        serviceType: "llm",
        remoteModelId: "local-llm",
        displayName: "Local LLM"
      });
      const gemini = providers.createProfile({
        id: "profile-gemini",
        serviceType: "llm",
        name: "Gemini",
        protocol: "gemini",
        baseUrl: "https://generativelanguage.test/v1beta",
        apiKeyEnvironmentVariable: "LYRA_TEST_GEMINI_KEY",
        enabled: false
      });
      await secrets.set(gemini.apiKeyEnvironmentVariable, "gemini-secret");
      const geminiLlm = providers.createModel(gemini.id, {
        serviceType: "llm",
        remoteModelId: "gemini-llm",
        displayName: "Gemini LLM"
      });
      const geminiImageProfile = providers.createProfile({
        id: "profile-gemini-image",
        serviceType: "image",
        name: "Gemini Image",
        protocol: "gemini",
        baseUrl: "https://generativelanguage.test/v1beta",
        apiKeyEnvironmentVariable: "LYRA_TEST_GEMINI_IMAGE_KEY",
        enabled: false
      });
      await secrets.set(geminiImageProfile.apiKeyEnvironmentVariable, "gemini-image-secret");
      const geminiImage = providers.createModel(geminiImageProfile.id, {
        serviceType: "image",
        remoteModelId: "gemini-image",
        displayName: "Gemini Image"
      });
      const factory = new RuntimeProviderFactory({ providers, secrets, assets });

      await expect(factory.createLlmProvider(openai.id, openaiLlm.id)).resolves.toBeInstanceOf(
        OpenAiResponsesLlmProvider
      );
      await expect(factory.createImageProvider(openaiImageProfile.id, openaiImage.id)).resolves.toBeInstanceOf(
        OpenAiImageProvider
      );
      providers.updateProfile(compatible.id, { enabled: true });
      await expect(
        factory.createLlmProvider(compatible.id, compatibleLlm.id)
      ).resolves.toBeInstanceOf(OpenAiCompatibleLlmProvider);
      providers.updateProfile(gemini.id, { enabled: true });
      await expect(factory.createLlmProvider(gemini.id, geminiLlm.id)).resolves.toBeInstanceOf(
        GeminiInteractionsLlmProvider
      );
      providers.updateProfile(geminiImageProfile.id, { enabled: true });
      await expect(factory.createImageProvider(geminiImageProfile.id, geminiImage.id)).resolves.toBeInstanceOf(
        GeminiImageProvider
      );
      await expect(factory.createLlmProvider(gemini.id, openaiLlm.id)).rejects.toMatchObject({
        code: "INVALID_CONFIGURATION"
      });
      await expect(factory.createLlmProvider(openai.id, openaiImage.id)).rejects.toMatchObject({
        code: "INVALID_CONFIGURATION"
      });
    } finally {
      database.close();
    }
  });
});
