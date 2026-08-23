import { describe, expect, it } from "vitest";
import type { GenerationRequest } from "@lyra/contracts";
import {
  DashScopeImageProvider,
  GeminiImageProvider,
  OpenAiImageProvider,
  ProviderHttpClient,
  StabilityImageProvider,
  type FetchLike,
  type ProviderAssetLoader
} from "@lyra/providers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("image provider adapters", () => {
  it("uses the DashScope multimodal image endpoint with ordered references", async () => {
    let body: Record<string, unknown> | null = null;
    const urls: string[] = [];
    const provider = new DashScopeImageProvider({
      baseUrl: "https://dashscope.test/api/v1",
      apiKey: "dashscope-secret",
      model: "qwen-image-3.0-pro",
      assetLoader: createLoader([]),
      client: new ProviderHttpClient({
        fetchImplementation: async (input, init = {}) => {
          const url = String(input);
          urls.push(url);
          if (url.includes("multimodal-generation")) {
            body = JSON.parse(String(init.body)) as Record<string, unknown>;
            return Response.json({
              output: {
                choices: [{ message: { content: [{ image: "https://cdn.test/qwen.png" }] } }]
              }
            });
          }
          return new Response(PNG, { headers: { "Content-Type": "image/png" } });
        }
      })
    });

    const images = await provider.generate(request({
      attachments: [{ assetId: "reference", position: 1, label: "图一" }],
      parameters: { aspectRatio: "16:9" }
    }));

    expect(urls[0]).toBe(
      "https://dashscope.test/api/v1/services/aigc/multimodal-generation/generation"
    );
    expect(body).toMatchObject({ model: "qwen-image-3.0-pro", size: "1664*928" });
    expect(images[0]?.data).toEqual(PNG);
  });

  it("sends Stability image generation as multipart and reads binary output", async () => {
    let form: FormData | null = null;
    let url = "";
    const provider = new StabilityImageProvider({
      baseUrl: "https://api.stability.test",
      apiKey: "stability-secret",
      model: "stable-image-core",
      assetLoader: createLoader([]),
      client: new ProviderHttpClient({
        fetchImplementation: async (input, init = {}) => {
          url = String(input);
          form = init.body as FormData;
          return new Response(PNG, { headers: { "Content-Type": "image/png" } });
        }
      })
    });

    const images = await provider.generate(request({ parameters: { aspectRatio: "3:2" } }));
    expect(url).toBe("https://api.stability.test/v2beta/stable-image/generate/core");
    expect(form!.get("prompt")).toBe("Draw an image");
    expect(form!.get("aspect_ratio")).toBe("3:2");
    expect(images[0]?.data).toEqual(PNG);
  });

  it("sends OpenAI edit attachments as ordered multipart image fields", async () => {
    const loaded: string[] = [];
    let form: FormData | null = null;
    const loader = createLoader(loaded);
    const provider = new OpenAiImageProvider({
      baseUrl: "https://api.openai.test/v1",
      apiKey: "secret",
      model: "gpt-image-test",
      assetLoader: loader,
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          form = init.body as FormData;
          return Response.json({
            data: [{ b64_json: PNG.toString("base64") }, { b64_json: PNG.toString("base64") }]
          });
        }
      })
    });
    const images = await provider.generate(
      request({
        count: 2,
        attachments: [
          { assetId: "asset-b", position: 1, label: "图二" },
          { assetId: "asset-a", position: 2, label: "图一" }
        ],
        parameters: { quality: "high", outputFormat: "png" }
      })
    );
    expect(loaded).toEqual(["asset-b", "asset-a"]);
    expect(form!.get("model")).toBe("gpt-image-test");
    expect(form!.get("quality")).toBe("high");
    const files = form!.getAll("image[]") as File[];
    expect(files.map((file) => file.name)).toEqual(["asset-b.png", "asset-a.png"]);
    expect(Buffer.from(await files[0]!.arrayBuffer()).toString()).toBe("asset-b");
    expect(Buffer.from(await files[1]!.arrayBuffer()).toString()).toBe("asset-a");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ mimeType: "image/png", name: "openai-output-1.png" });
  });

  it("downloads URL outputs from OpenAI-compatible image APIs", async () => {
    const urls: string[] = [];
    const fetchImplementation: FetchLike = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/images/generations")) {
        return Response.json({ data: [{ url: "https://cdn.test/output.png" }] });
      }
      return new Response(PNG, { headers: { "Content-Type": "image/png" } });
    };
    const provider = new OpenAiImageProvider({
      baseUrl: "http://local.test/v1",
      apiKey: null,
      model: "image-model",
      compatible: true,
      assetLoader: createLoader([]),
      client: new ProviderHttpClient({ fetchImplementation })
    });
    const images = await provider.generate(request({ count: 1 }));
    expect(urls).toEqual([
      "http://local.test/v1/images/generations",
      "https://cdn.test/output.png"
    ]);
    expect(images[0]?.data).toEqual(PNG);
  });

  it("maps the shared aspect ratio control to an OpenAI image size", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const provider = new OpenAiImageProvider({
      baseUrl: "https://api.openai.test/v1",
      apiKey: "secret",
      model: "gpt-image-test",
      assetLoader: createLoader([]),
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ data: [{ b64_json: PNG.toString("base64") }] });
        }
      })
    });

    await provider.generate(request({ count: 1, parameters: { aspectRatio: "16:9" } }));
    expect(requestBody).toMatchObject({ size: "1536x1024" });
  });

  it("falls back to chat completions when an OpenAI-compatible image route is missing", async () => {
    const urls: string[] = [];
    let chatBody: Record<string, unknown> | null = null;
    const provider = new OpenAiImageProvider({
      baseUrl: "https://compatible.test/v1",
      apiKey: "secret",
      model: "gemini-3.1-flash-image",
      compatible: true,
      assetLoader: createLoader([]),
      client: new ProviderHttpClient({
        fetchImplementation: async (input, init = {}) => {
          const url = String(input);
          urls.push(url);
          if (url.endsWith("/images/edits")) {
            return Response.json({ error: "not found" }, { status: 404 });
          }
          chatBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({
            choices: [{
              message: {
                images: [{
                  image_url: {
                    url: `data:image/png;base64,${PNG.toString("base64")}`
                  }
                }]
              }
            }]
          });
        }
      })
    });

    const images = await provider.generate(request({
      attachments: [{ assetId: "reference", position: 1, label: "图一" }]
    }));

    expect(urls).toEqual([
      "https://compatible.test/v1/images/edits",
      "https://compatible.test/v1/chat/completions"
    ]);
    expect(chatBody).toMatchObject({
      model: "gemini-3.1-flash-image",
      modalities: ["text", "image"],
      stream: false
    });
    const messages = chatBody!.messages as Array<Record<string, unknown>>;
    const content = messages[0]!.content as Array<Record<string, unknown>>;
    expect(content.map((item) => item.type)).toEqual(["text", "image_url"]);
    expect(images[0]).toMatchObject({
      mimeType: "image/png",
      name: "compatible-output-1.png"
    });
  });

  it("sends ordered Gemini image inputs and repeats calls for count", async () => {
    const loaded: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const provider = new GeminiImageProvider({
      baseUrl: "https://generativelanguage.test/v1beta",
      apiKey: "secret",
      model: "gemini-image-test",
      assetLoader: createLoader(loaded),
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json({
            id: `image-${bodies.length}`,
            steps: [
              {
                type: "model_output",
                content: [
                  { type: "image", mime_type: "image/png", data: PNG.toString("base64") }
                ]
              }
            ]
          });
        }
      })
    });
    const images = await provider.generate(
      request({
        count: 2,
        attachments: [
          { assetId: "first", position: 1, label: "图一" },
          { assetId: "second", position: 2, label: "图二" }
        ],
        parameters: { aspectRatio: "16:9", imageSize: "2K" }
      })
    );
    expect(loaded).toEqual(["first", "second"]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.response_format).toEqual({
      type: "image",
      aspect_ratio: "16:9",
      image_size: "2K"
    });
    expect((bodies[0]!.input as Array<Record<string, unknown>>).map((item) => item.type)).toEqual([
      "text",
      "image",
      "image"
    ]);
    expect(images.map((image) => image.name)).toEqual([
      "gemini-output-1.png",
      "gemini-output-2.png"
    ]);
  });
});

function createLoader(loaded: string[]): ProviderAssetLoader {
  return {
    async loadImage(assetId) {
      loaded.push(assetId);
      return {
        data: Buffer.from(assetId),
        mimeType: "image/png",
        name: `${assetId}.png`
      };
    }
  };
}

function request(overrides: Partial<GenerationRequest>): GenerationRequest {
  return {
    projectId: "project-1",
    prompt: "Draw an image",
    attachments: [],
    providerProfileId: "profile-1",
    providerModelId: "model-1",
    count: 1,
    parameters: {},
    source: "manual",
    ...overrides
  };
}
