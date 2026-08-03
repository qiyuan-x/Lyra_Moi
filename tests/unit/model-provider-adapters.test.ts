import { describe, expect, it } from "vitest";
import type {
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import {
  HunyuanModelProvider,
  MeshyModelProvider,
  ProviderHttpClient,
  TripoModelProvider,
  type FetchLike,
  type ModelProviderAssetLoader
} from "@lyra/providers";

const inputImage = Buffer.from("fake-jpeg");
const glb = createMinimalGlb();
const obj = Buffer.from("# model\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "utf8");
const loader: ModelProviderAssetLoader = {
  async loadModelInput() {
    return { data: inputImage, mimeType: "image/jpeg", name: "input.jpg" };
  }
};

describe("model provider adapters", () => {
  it("submits Meshy target formats and downloads every requested file", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const loadedAssetIds: string[] = [];
    const meshyLoader: ModelProviderAssetLoader = {
      async loadModelInput(assetId) {
        loadedAssetIds.push(assetId);
        return {
          data: assetId === "texture" ? Buffer.from("texture-jpeg") : inputImage,
          mimeType: "image/jpeg",
          name: `${assetId}.jpg`
        };
      }
    };
    const provider = new MeshyModelProvider({
      baseUrl: "https://api.meshy.ai",
      apiKey: "meshy-secret",
      model: "meshy-6",
      assetLoader: meshyLoader,
      settings: { texture_prompt: "must be replaced by the selected texture image" },
      client: httpClient(async (input, init) => {
        const url = String(input);
        calls.push({ url, ...(init ? { init } : {}) });
        if (url.endsWith("/image-to-3d") && init?.method === "POST") {
          return Response.json({ result: "meshy-task" });
        }
        if (url.endsWith("/image-to-3d/meshy-task")) {
          return Response.json({
            status: "SUCCEEDED",
            progress: 100,
            model_urls: {
              glb: "https://assets.example/model.glb",
              obj: "https://assets.example/model.obj"
            },
            thumbnail_url: "https://assets.example/preview.png",
            consumed_credits: 30
          });
        }
        return url.endsWith(".obj") ? binaryResponse(obj) : binaryResponse(glb);
      })
    });

    const modelRequest: ModelGenerationRequest = {
      ...request(["glb", "obj"]),
      textureImageAssetId: "texture"
    };
    const taskId = await provider.submit(modelRequest);
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(taskId).toBe("meshy-task");
    expect(body).toMatchObject({
      model_type: "standard",
      ai_model: "meshy-6",
      should_texture: true,
      enable_pbr: true,
      should_remesh: true,
      target_polycount: 100_000,
      target_formats: ["glb", "obj"]
    });
    expect(String(body.image_url)).toContain("data:image/jpeg;base64,");
    expect(String(body.texture_image_url)).toContain("data:image/jpeg;base64,");
    expect(body.texture_image_url).not.toBe(body.image_url);
    expect(body).not.toHaveProperty("texture_prompt");
    expect(loadedAssetIds).toEqual(["image", "texture"]);
    const result = await provider.query(taskId);
    expect(result).toMatchObject({
      status: "succeeded",
      progress: 100,
      modelUrls: {
        glb: "https://assets.example/model.glb",
        obj: "https://assets.example/model.obj"
      },
      consumedCredits: 30
    });
    const downloaded = await provider.download(result, modelRequest);
    expect(downloaded.map((file) => file.format)).toEqual(["glb", "obj"]);
    expect(downloaded[0]?.data).toEqual(glb);
    expect(downloaded[1]?.data).toEqual(obj);
  });

  it("packages Meshy OBJ outputs with texture URLs into a ZIP", async () => {
    const provider = new MeshyModelProvider({
      baseUrl: "https://api.meshy.ai",
      apiKey: "meshy-secret",
      model: "meshy-6",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/image-to-3d") && init?.method === "POST") {
          return Response.json({ result: "meshy-textured-task" });
        }
        if (url.endsWith("/image-to-3d/meshy-textured-task")) {
          return Response.json({
            status: "SUCCEEDED",
            progress: 100,
            model_urls: {
              obj: "https://assets.example/model.obj"
            },
            texture_urls: [{
              base_color: "https://assets.example/texture_base_color.png",
              normal: "https://assets.example/texture_normal.png"
            }]
          });
        }
        if (url.endsWith("texture_base_color.png")) return binaryResponse(Buffer.from("base-color"));
        if (url.endsWith("texture_normal.png")) return binaryResponse(Buffer.from("normal"));
        return binaryResponse(obj);
      })
    });

    const modelRequest = request(["obj"]);
    const result = await provider.query(await provider.submit(modelRequest));
    const [downloaded] = await provider.download(result, modelRequest);

    expect(result.textureUrls).toEqual([{
      baseColor: "https://assets.example/texture_base_color.png",
      normal: "https://assets.example/texture_normal.png"
    }]);
    expect(downloaded).toMatchObject({
      format: "obj",
      extension: "zip",
      mimeType: "application/zip",
      name: expect.stringMatching(/-obj\.zip$/u)
    });
    expect(downloaded?.data.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("uploads an image and creates a Tripo image-to-model task", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new TripoModelProvider({
      baseUrl: "https://api.tripo3d.ai/v2/openapi",
      apiKey: "tripo-secret",
      model: "P1-20260311",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        calls.push({ url, ...(init ? { init } : {}) });
        if (url.endsWith("/upload/sts")) {
          return Response.json({ code: 0, data: { image_token: "image-token" } });
        }
        if (url.endsWith("/task") && init?.method === "POST") {
          return Response.json({ code: 0, data: { task_id: "tripo-task" } });
        }
        if (url.endsWith("/task/tripo-task")) {
          return Response.json({
            code: 0,
            data: {
              status: "success",
              progress: 100,
              output: {
                pbr_model: "https://assets.example/pbr.glb",
                rendered_image: "https://assets.example/render.png"
              }
            }
          });
        }
        return binaryResponse(glb);
      })
    });

    const modelRequest = request(["glb"], {
      targetFaceCount: 20_000,
      textureQuality: "extreme",
      imageAutofix: true,
      orientation: "align_image"
    });
    const taskId = await provider.submit(modelRequest);
    const createCall = calls.find((call) =>
      call.url.endsWith("/task") && call.init?.method === "POST"
    );
    expect(JSON.parse(String(createCall?.init?.body))).toMatchObject({
      type: "image_to_model",
      model_version: "P1-20260311",
      file: { type: "jpg", file_token: "image-token" },
      texture: true,
      pbr: true,
      face_limit: 20_000,
      texture_quality: "extreme",
      enable_image_autofix: true,
      orientation: "align_image"
    });
    expect(taskId.startsWith("tripo:")).toBe(true);
    const result = await provider.query(taskId);
    expect(result).toMatchObject({
      status: "succeeded",
      modelUrls: { glb: "https://assets.example/pbr.glb" }
    });
    expect((await provider.download(result, modelRequest))[0]?.data).toEqual(glb);
  });

  it("converts Tripo GLB output into the selected export formats", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const provider = new TripoModelProvider({
      baseUrl: "https://api.tripo3d.ai/v2/openapi",
      apiKey: "tripo-secret",
      model: "v3.0-20250812",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as Record<string, unknown>
          : undefined;
        calls.push({ url, ...(body ? { body } : {}) });
        if (url.endsWith("/upload/sts")) {
          return Response.json({ code: 0, data: { image_token: "image-token" } });
        }
        if (url.endsWith("/task") && body?.type === "image_to_model") {
          return Response.json({ code: 0, data: { task_id: "generation-task" } });
        }
        if (url.endsWith("/task") && body?.type === "convert_model") {
          const format = body.format === "OBJ" ? "obj" : "fbx";
          return Response.json({ code: 0, data: { task_id: `convert-${format}` } });
        }
        if (url.endsWith("/task/generation-task")) {
          return Response.json({
            code: 0,
            data: {
              status: "success",
              progress: 100,
              output: {
                pbr_model: "https://assets.example/model.glb",
                rendered_image: "https://assets.example/render.png"
              }
            }
          });
        }
        const format = url.endsWith("/task/convert-obj") ? "obj" : "fbx";
        return Response.json({
          code: 0,
          data: {
            status: "success",
            progress: 100,
            output: { model: `https://assets.example/model.${format}` }
          }
        });
      })
    });

    const modelRequest = request(["glb", "obj", "fbx"]);
    const taskId = await provider.submit(modelRequest);
    const converting = await provider.query(taskId);
    expect(converting.status).toBe("running");
    expect(converting.nextExternalTaskId).toMatch(/^tripo:/u);
    expect(calls.filter((call) => call.body?.type === "convert_model").map((call) => call.body?.format))
      .toEqual(["OBJ", "FBX"]);

    const result = await provider.query(converting.nextExternalTaskId!);
    expect(result).toMatchObject({
      status: "succeeded",
      modelUrls: {
        glb: "https://assets.example/model.glb",
        obj: "https://assets.example/model.obj",
        fbx: "https://assets.example/model.fbx"
      }
    });
  });

  it("uses Hunyuan API Key endpoints and reads the GLB result", async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const provider = new HunyuanModelProvider({
      baseUrl: "https://api.ai3d.cloud.tencent.com",
      apiKey: "sk-hunyuan",
      model: "3.1",
      assetLoader: loader,
      settings: {
        __lyra: {
          apiKeyWebsite: "https://example.com/api-keys",
          apiKeyGuide: "internal note"
        }
      },
      client: httpClient(async (input, init) => {
        const url = String(input);
        if (url.includes("model.glb")) return binaryResponse(glb);
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ url, headers, body });
        if (url.endsWith("/v1/ai3d/submit")) {
          return Response.json({ JobId: "hunyuan-task", RequestId: "request-1" });
        }
        return Response.json({
          Status: "DONE",
          ResultCreditConsumed: 40,
          ResultFile3Ds: [
            { Type: "GLB", Url: "https://assets.example/model.glb" },
            { Type: "IMAGE", Url: "https://assets.example/model.png" }
          ],
          RequestId: "request-2"
        });
      })
    });

    const modelRequest = request(["glb"]);
    const taskId = await provider.submit(modelRequest);
    expect(taskId).toBe("hunyuan-task");
    expect(calls[0]?.url).toBe("https://api.ai3d.cloud.tencent.com/v1/ai3d/submit");
    expect(calls[0]?.headers.get("authorization")).toBe("sk-hunyuan");
    expect(calls[0]?.body).toMatchObject({
      Model: "3.1",
      ImageUrl: { Url: expect.stringContaining("data:image/jpeg;base64,") },
      GenerateType: "Normal",
      EnablePBR: true,
      FaceCount: 100_000
    });
    expect(calls[0]?.body).not.toHaveProperty("__lyra");
    const result = await provider.query(taskId);
    expect(result).toMatchObject({
      status: "succeeded",
      modelUrls: { glb: "https://assets.example/model.glb" },
      previewUrl: "https://assets.example/model.png",
      consumedCredits: 40
    });
    expect((await provider.download(result, modelRequest))[0]?.data).toEqual(glb);
  });
});

function request(
  outputFormats: ModelOutputFormat[],
  parameterOverrides: Record<string, unknown> = {}
): ModelGenerationRequest {
  return {
    projectId: "project",
    inputImageAssetId: "image",
    providerProfileId: "profile",
    providerModelId: "model",
    outputFormats,
    parameters: {
      texture: true,
      pbr: true,
      targetFaceCount: 100_000,
      ...parameterOverrides
    },
    source: "manual"
  };
}

function httpClient(fetchImplementation: FetchLike) {
  return new ProviderHttpClient({
    fetchImplementation,
    timeoutMs: 5_000,
    maxResponseBytes: 10 * 1024 * 1024
  });
}

function binaryResponse(value: Buffer): Response {
  return new Response(new Uint8Array(value), {
    headers: { "Content-Type": "application/octet-stream" }
  });
}

function createMinimalGlb(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}   ', "utf8");
  const output = Buffer.alloc(20 + json.length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  return output;
}
