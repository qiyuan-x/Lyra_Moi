import { describe, expect, it } from "vitest";
import {
  HunyuanModelDiscoveryAdapter,
  MeshyModelDiscoveryAdapter,
  ProviderConnectionError,
  ProviderHttpClient,
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
  it("discovers FrostAPI 3D models through the models endpoint", async () => {
    let headers = new Headers();
    let url = "";
    const registry = createHttpProviderRegistry({
      fetchImplementation: async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        return Response.json({
          data: [
            { id: "meshy-6", object: "model", owned_by: "meshy" },
            { id: "meshy-7", object: "model", owned_by: "meshy" }
          ]
        });
      }
    });
    const models = await registry.discoverModels({
      profile: {
        ...profile("openai-compatible", "https://api.frost.test"),
        serviceType: "model",
        adapterType: "frostapi-3d"
      },
      apiKey: "frost-secret",
      signal: undefined
    });

    expect(url).toBe("https://api.frost.test/v1/models");
    expect(headers.get("authorization")).toBe("Bearer frost-secret");
    expect(models).toEqual([
      {
        remoteModelId: "meshy-6",
        displayName: "meshy-6",
        metadata: { ownedBy: "meshy" }
      },
      {
        remoteModelId: "meshy-7",
        displayName: "meshy-7",
        metadata: { ownedBy: "meshy" }
      }
    ]);
  });

  it("discovers the current Meshy model lineup", async () => {
    const adapter = new MeshyModelDiscoveryAdapter(new ProviderHttpClient({
      fetchImplementation: async () => Response.json({ data: [] })
    }));
    const models = await adapter.discoverModels({
      profile: {
        ...profile("openai-compatible", "https://api.meshy.ai"),
        serviceType: "model",
        adapterType: "meshy"
      },
      apiKey: "meshy-secret",
      signal: undefined
    });

    expect(models.map((model) => model.remoteModelId)).toEqual([
      "latest",
      "meshy-7",
      "meshy-6",
      "meshy-5",
      "meshy-t2",
      "meshy-t1"
    ]);
  });

  it("discovers supported Hunyuan 3D models through TokenHub", async () => {
    let url = "";
    let headers = new Headers();
    const adapter = new HunyuanModelDiscoveryAdapter(new ProviderHttpClient({
      fetchImplementation: async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        return Response.json({
          object: "list",
          data: [
            { id: "hy-3d-3.0", name: "HY-3D-3.0", status: "online" },
            { id: "HY-3D-3.1", name: "HY-3D-3.1", status: "online" },
            { id: "hy-3d-express", name: "HY-3D-Express", status: "online" },
            { id: "deepseek-v4", name: "DeepSeek", status: "online" }
          ]
        });
      }
    }));
    const models = await adapter.discoverModels({
      profile: {
        ...profile("openai-compatible", "https://tokenhub.tencentmaas.com"),
        serviceType: "model",
        adapterType: "hunyuan"
      },
      apiKey: "tokenhub-secret",
      signal: undefined
    });

    expect(url).toBe("https://tokenhub.tencentmaas.com/v1/models");
    expect(headers.get("authorization")).toBe("Bearer tokenhub-secret");
    expect(models.map((model) => model.remoteModelId)).toEqual([
      "hy-3d-3.1",
      "hy-3d-3.0"
    ]);
  });

  it("automatically accepts a legacy Hunyuan API key", async () => {
    const calls: Array<{ url: string; headers: Headers; body?: Record<string, unknown> }> = [];
    const adapter = new HunyuanModelDiscoveryAdapter(new ProviderHttpClient({
      fetchImplementation: async (input, init) => {
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as Record<string, unknown>
          : undefined;
        calls.push({
          url: String(input),
          headers: new Headers(init?.headers),
          ...(body ? { body } : {})
        });
        if (String(input).endsWith("/v1/models")) {
          return Response.json(
            { error: { message: "invalid token" } },
            { status: 401 }
          );
        }
        return Response.json({
          ErrorCode: "InvalidParameterValue.JobId",
          ErrorMessage: "JobId does not exist"
        });
      }
    }));

    const models = await adapter.discoverModels({
      profile: {
        ...profile("openai-compatible", "https://tokenhub.tencentmaas.com"),
        serviceType: "model",
        adapterType: "hunyuan"
      },
      apiKey: "legacy-token",
      signal: undefined
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://tokenhub.tencentmaas.com/v1/models",
      "https://api.ai3d.cloud.tencent.com/v1/ai3d/query"
    ]);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer legacy-token");
    expect(calls[1]?.headers.get("authorization")).toBe("legacy-token");
    expect(calls[1]?.body).toEqual({ JobId: "lyra-connection-test" });
    expect(models.map((model) => model.remoteModelId)).toEqual([
      "hy-3d-3.1",
      "hy-3d-3.0"
    ]);
  });

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

  it("uses the native Anthropic models endpoint and API key header", async () => {
    let request: { url: string; init: RequestInit | undefined } | null = null;
    const registry = createHttpProviderRegistry({
      fetchImplementation: async (input, init) => {
        request = { url: String(input), init };
        return Response.json({
          data: [{ id: "claude-test", display_name: "Claude Test" }]
        });
      }
    });
    const anthropic = {
      ...profile("anthropic", "https://api.anthropic.test/v1"),
      adapterType: "anthropic" as const
    };

    const models = await registry.discoverModels({
      profile: anthropic,
      apiKey: "anthropic-secret",
      secondaryApiKey: null,
      signal: undefined
    });

    expect(request!.url).toBe("https://api.anthropic.test/v1/models");
    expect(request!.init?.headers).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(models).toEqual([{
      remoteModelId: "claude-test",
      displayName: "Claude Test",
      metadata: {}
    }]);
  });

  it("uses DashScope compatibility discovery without changing its native image URL", async () => {
    let url = "";
    const registry = createHttpProviderRegistry({
      fetchImplementation: async (input) => {
        url = String(input);
        return Response.json({ data: [] });
      }
    });
    const dashscope = {
      ...profile("openai-compatible", "https://dashscope.aliyuncs.com/api/v1"),
      serviceType: "image" as const,
      adapterType: "dashscope-image" as const
    };

    const models = await registry.discoverModels({
      profile: dashscope,
      apiKey: "dashscope-secret",
      secondaryApiKey: null,
      signal: undefined
    });

    expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
    expect(models.map((model) => model.remoteModelId)).toContain("qwen-image-3.0-pro");
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
    expect(normalizeBaseUrl(
      "openai-compatible",
      "https://api.stability.ai",
      "image",
      "stability-image"
    )).toBe("https://api.stability.ai");
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
    adapterType: protocol,
    baseUrl,
    apiKeyEnvironmentVariable: "LYRA_PROVIDER_TEST_API_KEY",
    secondaryApiKeyEnvironmentVariable: null,
    settings: {},
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null
  };
}
