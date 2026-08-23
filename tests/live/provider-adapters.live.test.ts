import { describe, expect, it } from "vitest";
import type { ProviderAssetLoader } from "@lyra/providers";
import {
  GeminiImageProvider,
  GeminiInteractionsLlmProvider,
  OpenAiCompatibleLlmProvider,
  OpenAiImageProvider,
  OpenAiResponsesLlmProvider,
  createHttpProviderRegistry
} from "@lyra/providers";

const enabled = process.env.LYRA_RUN_LIVE_PROVIDER_TESTS === "1";
const unusedAssetLoader: ProviderAssetLoader = {
  async loadImage() {
    throw new Error("Live text-to-image checks do not load attachments.");
  }
};

describe.skipIf(!enabled)("live provider adapters", () => {
  it.skipIf(!hasEnvironment("LYRA_LIVE_FROST_API_KEY"))(
    "discovers the configured FrostAPI AI3D models",
    async () => {
      const baseUrl = environment(
        "LYRA_LIVE_FROST_BASE_URL",
        "https://api.linfrsot.cloud"
      );
      const registry = createHttpProviderRegistry();
      const models = await registry.discoverModels({
        profile: {
          id: "frost-live",
          serviceType: "model",
          name: "FrostAPI",
          protocol: "openai-compatible",
          adapterType: "openai-compatible",
          baseUrl,
          apiKeyEnvironmentVariable: "LYRA_LIVE_FROST_API_KEY",
          secondaryApiKeyEnvironmentVariable: null,
          settings: {},
          enabled: true,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          deletedAt: null
        },
        apiKey: environment("LYRA_LIVE_FROST_API_KEY"),
        secondaryApiKey: null,
        signal: AbortSignal.timeout(30_000)
      });
      expect(models.map((model) => model.remoteModelId)).toEqual([
        "meshy-6",
        "meshy-7"
      ]);
    }
  );

  it.skipIf(!hasEnvironment("LYRA_LIVE_OPENAI_API_KEY", "LYRA_LIVE_OPENAI_LLM_MODEL"))(
    "calls the configured OpenAI LLM",
    async () => {
      const provider = new OpenAiResponsesLlmProvider({
        baseUrl: environment("LYRA_LIVE_OPENAI_BASE_URL", "https://api.openai.com/v1"),
        apiKey: environment("LYRA_LIVE_OPENAI_API_KEY"),
        model: environment("LYRA_LIVE_OPENAI_LLM_MODEL")
      });
      const result = await provider.complete({
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        tools: [],
        signal: AbortSignal.timeout(120_000)
      });
      expect(result.type).toBe("message");
    }
  );

  it.skipIf(!hasEnvironment("LYRA_LIVE_OPENAI_API_KEY", "LYRA_LIVE_OPENAI_IMAGE_MODEL"))(
    "calls the configured OpenAI image model",
    async () => {
      const provider = new OpenAiImageProvider({
        baseUrl: environment("LYRA_LIVE_OPENAI_BASE_URL", "https://api.openai.com/v1"),
        apiKey: environment("LYRA_LIVE_OPENAI_API_KEY"),
        model: environment("LYRA_LIVE_OPENAI_IMAGE_MODEL"),
        assetLoader: unusedAssetLoader
      });
      const output = await provider.generate(imageRequest("openai"), AbortSignal.timeout(300_000));
      expect(output[0]?.data.byteLength).toBeGreaterThan(0);
    }
  );

  it.skipIf(!hasEnvironment("LYRA_LIVE_GEMINI_API_KEY", "LYRA_LIVE_GEMINI_LLM_MODEL"))(
    "calls the configured Gemini LLM",
    async () => {
      const provider = new GeminiInteractionsLlmProvider({
        baseUrl: environment(
          "LYRA_LIVE_GEMINI_BASE_URL",
          "https://generativelanguage.googleapis.com/v1beta"
        ),
        apiKey: environment("LYRA_LIVE_GEMINI_API_KEY"),
        model: environment("LYRA_LIVE_GEMINI_LLM_MODEL")
      });
      const result = await provider.complete({
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        tools: [],
        signal: AbortSignal.timeout(120_000)
      });
      expect(result.type).toBe("message");
    }
  );

  it.skipIf(!hasEnvironment("LYRA_LIVE_GEMINI_API_KEY", "LYRA_LIVE_GEMINI_IMAGE_MODEL"))(
    "calls the configured Gemini image model",
    async () => {
      const provider = new GeminiImageProvider({
        baseUrl: environment(
          "LYRA_LIVE_GEMINI_BASE_URL",
          "https://generativelanguage.googleapis.com/v1beta"
        ),
        apiKey: environment("LYRA_LIVE_GEMINI_API_KEY"),
        model: environment("LYRA_LIVE_GEMINI_IMAGE_MODEL"),
        assetLoader: unusedAssetLoader
      });
      const output = await provider.generate(imageRequest("gemini"), AbortSignal.timeout(300_000));
      expect(output[0]?.data.byteLength).toBeGreaterThan(0);
    }
  );

  it.skipIf(!hasEnvironment("LYRA_LIVE_COMPATIBLE_BASE_URL", "LYRA_LIVE_COMPATIBLE_LLM_MODEL"))(
    "calls the configured OpenAI-compatible LLM",
    async () => {
      const provider = new OpenAiCompatibleLlmProvider({
        baseUrl: environment("LYRA_LIVE_COMPATIBLE_BASE_URL"),
        apiKey: optionalEnvironment("LYRA_LIVE_COMPATIBLE_API_KEY"),
        model: environment("LYRA_LIVE_COMPATIBLE_LLM_MODEL")
      });
      const result = await provider.complete({
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        tools: [],
        signal: AbortSignal.timeout(120_000)
      });
      expect(result.type).toBe("message");
    }
  );

  it.skipIf(!hasEnvironment("LYRA_LIVE_COMPATIBLE_BASE_URL", "LYRA_LIVE_COMPATIBLE_IMAGE_MODEL"))(
    "calls the configured OpenAI-compatible image model",
    async () => {
      const provider = new OpenAiImageProvider({
        baseUrl: environment("LYRA_LIVE_COMPATIBLE_BASE_URL"),
        apiKey: optionalEnvironment("LYRA_LIVE_COMPATIBLE_API_KEY"),
        model: environment("LYRA_LIVE_COMPATIBLE_IMAGE_MODEL"),
        compatible: true,
        assetLoader: unusedAssetLoader
      });
      const output = await provider.generate(
        imageRequest("compatible"),
        AbortSignal.timeout(300_000)
      );
      expect(output[0]?.data.byteLength).toBeGreaterThan(0);
    }
  );
});

function imageRequest(provider: string) {
  return {
    projectId: "live-test",
    prompt: "A simple solid blue circle centered on a white background.",
    attachments: [],
    providerProfileId: provider,
    providerModelId: provider,
    count: 1,
    parameters: {},
    source: "manual" as const
  };
}

function hasEnvironment(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function environment(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`Missing live test environment variable: ${name}`);
  return value;
}

function optionalEnvironment(name: string): string | null {
  return process.env[name]?.trim() || null;
}
