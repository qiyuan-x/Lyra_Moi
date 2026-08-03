import { describe, expect, it } from "vitest";
import {
  ProviderConnectionError,
  createHttpProviderRegistry,
  filterDiscoveredModels,
  isImageGenerationModelId,
  normalizeBaseUrl,
  redactSensitiveData,
  sanitizeError,
  type FetchLike
} from "@lyra/providers";
import type { StoredProviderProfile } from "@lyra/storage";

describe("HTTP provider model discovery", () => {
  it("keeps image models out of LLM connections and LLM models out of image connections", () => {
    const models = [
      { remoteModelId: "gpt-5.6", displayName: "GPT 5.6", metadata: {} },
      { remoteModelId: "gpt-image-2", displayName: "GPT Image 2", metadata: {} },
      { remoteModelId: "gemini-3.1-flash-image", displayName: "Nano Banana 2", metadata: {} },
      { remoteModelId: "flux-1.1-pro", displayName: "Flux", metadata: {} }
    ];
    expect(filterDiscoveredModels(
      { protocol: "openai-compatible", serviceType: "image" },
      models
    ).map((model) => model.remoteModelId)).toEqual([
      "gpt-image-2",
      "gemini-3.1-flash-image",
      "flux-1.1-pro"
    ]);
    expect(filterDiscoveredModels(
      { protocol: "openai-compatible", serviceType: "llm" },
      models
    ).map((model) => model.remoteModelId)).toEqual(["gpt-5.6"]);
    expect(isImageGenerationModelId("gemini-3-pro-image", "gemini")).toBe(true);
    expect(isImageGenerationModelId("gemini-3.1-pro", "gemini")).toBe(false);
  });

  it("uses the OpenAI models endpoint and bearer authentication", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({
        object: "list",
        data: [
          { id: "model-b", owned_by: "vendor" },
          { id: "model-a", owned_by: "vendor" }
        ]
      });
    };
    const registry = createHttpProviderRegistry({ fetchImplementation });

    const models = await registry.discoverModels({
      profile: profile("openai", "https://api.openai.com/v1"),
      apiKey: "openai-secret",
      signal: undefined
    });

    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer openai-secret"
    });
    expect(models.map((model) => model.remoteModelId)).toEqual(["model-a", "model-b"]);
  });

  it("paginates Gemini models and uses the API key header", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return Response.json({
          models: [
            {
              name: "models/gemini-a",
              displayName: "Gemini A",
              supportedGenerationMethods: ["generateContent"]
            }
          ],
          nextPageToken: "next-token"
        });
      }
      return Response.json({
        models: [{ name: "models/gemini-b", displayName: "Gemini B" }]
      });
    };
    const registry = createHttpProviderRegistry({ fetchImplementation });

    const models = await registry.discoverModels({
      profile: profile("gemini", "https://generativelanguage.googleapis.com/v1beta"),
      apiKey: "gemini-secret",
      signal: undefined
    });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!.url).searchParams.get("pageToken")).toBe("next-token");
    expect(calls[0]?.init?.headers).toMatchObject({ "x-goog-api-key": "gemini-secret" });
    expect(models.map((model) => model.remoteModelId)).toEqual(["gemini-a", "gemini-b"]);
  });

  it("allows an OpenAI-compatible local endpoint without a key", async () => {
    let requestInit: RequestInit | undefined;
    const registry = createHttpProviderRegistry({
      fetchImplementation: async (_input, init) => {
        requestInit = init;
        return Response.json({ data: [{ id: "local-image-model" }] });
      }
    });

    const models = await registry.discoverModels({
      profile: profile("openai-compatible", "http://127.0.0.1:9000/v1"),
      apiKey: null,
      signal: undefined
    });

    expect(requestInit?.headers).not.toHaveProperty("Authorization");
    expect(models[0]?.remoteModelId).toBe("local-image-model");
  });

  it("reports unsupported compatible discovery without blocking manual models", async () => {
    const registry = createHttpProviderRegistry({
      fetchImplementation: async () => new Response(null, { status: 404 })
    });
    await expect(
      registry.discoverModels({
        profile: profile("openai-compatible", "http://127.0.0.1:9000/v1"),
        apiKey: null,
        signal: undefined
      })
    ).rejects.toMatchObject({ code: "DISCOVERY_UNSUPPORTED", statusCode: 404 });
  });

  it("returns stable errors without including API keys", async () => {
    const secret = "must-not-leak";
    const registry = createHttpProviderRegistry({
      fetchImplementation: async () => new Response("failure", { status: 401 })
    });

    let caught: unknown;
    try {
      await registry.discoverModels({
        profile: profile("openai", "https://api.openai.com/v1"),
        apiKey: secret,
        signal: undefined
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderConnectionError);
    expect(caught).toMatchObject({ code: "AUTHENTICATION_FAILED", statusCode: 401 });
    expect(String(caught)).not.toContain(secret);
    expect(JSON.stringify(caught)).not.toContain(secret);
  });

  it("normalizes configurable local URLs and rejects embedded credentials", () => {
    expect(normalizeBaseUrl("openai-compatible", "http://localhost:8080/v1///")).toBe(
      "http://localhost:8080/v1"
    );
    expect(normalizeBaseUrl("openai-compatible", "http://localhost:8080")).toBe(
      "http://localhost:8080/v1"
    );
    expect(() =>
      normalizeBaseUrl("openai-compatible", "http://user:password@localhost/v1")
    ).toThrow("cannot contain credentials");
  });

  it("redacts provider secrets from structured logs and errors", () => {
    const secret = "provider-secret";
    const redacted = redactSensitiveData(
      {
        headers: { Authorization: `Bearer ${secret}`, "x-goog-api-key": secret },
        url: `https://example.test/models?key=${secret}`,
        nested: { message: `request failed for ${secret}` }
      },
      [secret]
    );
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(sanitizeError(new Error(`failed: ${secret}`), [secret]).message).toBe(
      "failed: [REDACTED]"
    );
  });
});

function profile(
  protocol: StoredProviderProfile["protocol"],
  baseUrl: string
): StoredProviderProfile {
  return {
    id: `profile-${protocol}`,
    serviceType: "llm",
    name: protocol,
    protocol,
    baseUrl,
    apiKeyEnvironmentVariable: "LYRA_PROVIDER_TEST_API_KEY",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null
  };
}
