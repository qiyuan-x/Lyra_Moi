import { describe, expect, it } from "vitest";
import type {
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import {
  FrostApiModelProvider,
  HunyuanModelProvider,
  MeshyModelProvider,
  ProviderHttpClient,
  StabilityModelProvider,
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
  it("reuses Meshy settings through FrostAPI 3D", async () => {
    const calls: Array<{ url: string; headers: Headers; body?: Record<string, unknown> }> = [];
    let pollCount = 0;
    const provider = new FrostApiModelProvider({
      baseUrl: "https://api.frost.test",
      apiKey: "frost-secret",
      model: "meshy-7",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as Record<string, unknown>
          : undefined;
        calls.push({
          url,
          headers: new Headers(init?.headers),
          ...(body ? { body } : {})
        });
        if (url.endsWith("/v1/3d/generations")) {
          return Response.json({
            id: "frost-task",
            status: "processing",
            poll_url: "/v1/3d/tasks/frost-task"
          }, { status: 202 });
        }
        if (url.endsWith("/v1/3d/tasks/frost-task")) {
          pollCount += 1;
          return pollCount === 1
            ? Response.json({ id: "frost-task", status: "processing" })
            : Response.json({
                id: "frost-task",
                status: "completed",
                result: {
                  preview_url: "https://assets.example/preview.png",
                  files: [{
                    format: "glb",
                    name: "output.glb",
                    size: glb.length,
                    url: "https://api.frost.test/v1/3d/tasks/frost-task/files/output.glb"
                  }, {
                    format: "obj",
                    name: "output.obj",
                    size: obj.length,
                    url: "https://api.frost.test/v1/3d/tasks/frost-task/files/output.obj"
                  }]
                }
              });
        }
        return binaryResponse(url.endsWith("output.obj") ? obj : glb);
      })
    });

    const modelRequest: ModelGenerationRequest = {
      ...request(["glb", "obj"], {
        textureResolution: "4k",
        ultraMode: true,
        textureGuideMode: "image",
        savePreRemeshedModel: true,
        moderation: true,
        autoSize: true,
        originAt: "center",
        multiViewThumbnails: true,
        alphaThumbnail: true
      }),
      textureImageAssetId: "texture"
    };
    const taskId = await provider.submit(modelRequest);
    expect(taskId).toBe("frost-task");
    expect(calls[0]?.url).toBe("https://api.frost.test/v1/3d/generations");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer frost-secret");
    expect(calls[0]?.body).toMatchObject({
      model: "meshy-7",
      image_url: `data:image/jpeg;base64,${inputImage.toString("base64")}`,
      texture_image_url: `data:image/jpeg;base64,${inputImage.toString("base64")}`,
      model_type: "standard",
      should_texture: true,
      enable_pbr: true,
      target_formats: ["glb", "obj"],
      texture_resolution: "4k",
      should_remesh: true,
      topology: "triangle",
      target_polycount: 100_000,
      save_pre_remeshed_model: true,
      image_enhancement: true,
      moderation: true,
      auto_size: true,
      origin_at: "center",
      multi_view_thumbnails: true,
      alpha_thumbnail: true,
      ultra_mode: true
    });
    expect(await provider.query(taskId)).toMatchObject({
      status: "running",
      progress: 10
    });
    const result = await provider.query(taskId);
    expect(result).toMatchObject({
      status: "succeeded",
      progress: 100,
      modelUrls: {
        glb: "https://api.frost.test/v1/3d/tasks/frost-task/files/output.glb",
        obj: "https://api.frost.test/v1/3d/tasks/frost-task/files/output.obj"
      },
      previewUrl: "https://assets.example/preview.png"
    });
    const downloaded = await provider.download(result, modelRequest);
    expect(downloaded.map((file) => file.format)).toEqual(["glb", "obj"]);
    expect(downloaded[0]?.data).toEqual(glb);
    expect(downloaded[1]?.data).toEqual(obj);
    expect(calls.at(-1)?.headers.get("authorization")).toBe("Bearer frost-secret");
  });

  it("submits Meshy text settings and rejects unknown FrostAPI models", async () => {
    let body: Record<string, unknown> | null = null;
    let requestUrl = "";
    const provider = new FrostApiModelProvider({
      baseUrl: "https://api.frost.test/v1",
      apiKey: "frost-secret",
      model: "meshy-6",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        requestUrl = String(input);
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "frost-text-task", status: "processing" }, { status: 202 });
      })
    });

    await expect(provider.submit(textRequest({
      textureGuideMode: "text",
      texturePrompt: "磨砂金属表面"
    }))).resolves.toBe("frost-text-task");
    expect(requestUrl).toBe("https://api.frost.test/v1/3d/generations");
    expect(body).toMatchObject({
      model: "meshy-6",
      prompt: "a low poly spaceship",
      model_type: "standard",
      should_texture: true,
      enable_pbr: true,
      target_formats: ["glb"],
      should_remesh: true,
      target_polycount: 20_000,
      texture_prompt: "磨砂金属表面",
      remove_lighting: true
    });

    const genericProvider = new FrostApiModelProvider({
      baseUrl: "https://api.frost.test",
      apiKey: "frost-secret",
      model: "generic-3d",
      assetLoader: loader,
      client: httpClient(async () => Response.json({ id: "unused" }))
    });
    await expect(genericProvider.submit(request(["obj"]))).rejects.toThrow(
      "FrostAPI model is not supported"
    );
  });

  it("builds Tripo request fields for FrostAPI from the selected Tripo model", async () => {
    let body: Record<string, unknown> = {};
    const provider = new FrostApiModelProvider({
      baseUrl: "https://api.frost.test",
      apiKey: "frost-secret",
      model: "v3.1-20260211",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "tripo-task" }, { status: 202 });
      })
    });

    await expect(provider.submit(request(["glb"], {
      geometryQuality: "detailed",
      textureQuality: "extreme",
      imageAutofix: true,
      targetFaceCount: 250_000
    }))).resolves.toBe("tripo-task");
    expect(body).toMatchObject({
      model: "v3.1-20260211",
      type: "image_to_model",
      model_version: "v3.1-20260211",
      image_url: `data:image/jpeg;base64,${inputImage.toString("base64")}`,
      geometry_quality: "detailed",
      texture_quality: "extreme",
      enable_image_autofix: true,
      face_limit: 250_000
    });
  });

  it("builds Hunyuan multi-view request fields for FrostAPI", async () => {
    let body: Record<string, unknown> = {};
    const provider = new FrostApiModelProvider({
      baseUrl: "https://api.frost.test",
      apiKey: "frost-secret",
      model: "hy-3d-3.1",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "hunyuan-task" }, { status: 202 });
      })
    });

    await expect(provider.submit(multiViewRequest({
      generateType: "Normal",
      pbr: false,
      targetFaceCount: 500_000
    }))).resolves.toBe("hunyuan-task");
    expect(body).toMatchObject({
      model: "hy-3d-3.1",
      image_base64: inputImage.toString("base64"),
      generate_type: "normal",
      enable_pbr: false,
      face_count: 500_000,
      multi_view_images: [
        { view: "left", image: inputImage.toString("base64") },
        { view: "right", image: inputImage.toString("base64") }
      ]
    });
  });

  it("creates a Stability image-to-3D GLB result", async () => {
    let form: FormData | null = null;
    const glb = Buffer.from("glb-result");
    const provider = new StabilityModelProvider({
      baseUrl: "https://api.stability.test",
      apiKey: "stability-secret",
      model: "spar3d",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        expect(String(input)).toBe(
          "https://api.stability.test/v2beta/3d/stable-point-aware-3d"
        );
        form = init?.body as FormData;
        return new Response(glb, { headers: { "Content-Type": "model/gltf-binary" } });
      })
    });

    const taskId = await provider.submit(request({ outputFormats: ["glb"] }));
    expect(form!.get("image")).toBeInstanceOf(File);
    const result = await provider.query(taskId);
    expect(result).toMatchObject({ status: "succeeded", progress: 100 });
    const files = await provider.download(result, request({ outputFormats: ["glb"] }));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ format: "glb", extension: "glb" });
    expect(files[0]?.data).toEqual(glb);
  });

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

  it("submits and polls Meshy multi-image tasks through the official endpoint", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const loadedAssetIds: string[] = [];
    const provider = new MeshyModelProvider({
      baseUrl: "https://api.meshy.ai",
      apiKey: "meshy-secret",
      model: "meshy-7",
      assetLoader: {
        async loadModelInput(assetId) {
          loadedAssetIds.push(assetId);
          return {
            data: Buffer.from(assetId, "utf8"),
            mimeType: "image/jpeg",
            name: `${assetId}.jpg`
          };
        }
      },
      settings: { image_urls: ["must-not-be-used"], ultra_mode: true },
      client: httpClient(async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as Record<string, unknown>
          : undefined;
        calls.push({ url, ...(body ? { body } : {}) });
        if (url.endsWith("/multi-image-to-3d") && init?.method === "POST") {
          return Response.json({ result: "meshy-multi-task" });
        }
        if (url.endsWith("/multi-image-to-3d/meshy-multi-task")) {
          return Response.json({
            status: "SUCCEEDED",
            progress: 100,
            model_urls: { glb: "https://assets.example/multi.glb" }
          });
        }
        throw new Error(`Unexpected Meshy request: ${url}`);
      })
    });

    const taskId = await provider.submit(multiViewRequest({
      textureGuideMode: "text",
      texturePrompt: "painted metal",
      remesh: true,
      topology: "quad",
      targetFaceCount: 30_000,
      imageEnhancement: false,
      removeLighting: false,
      autoSize: true,
      originAt: "center",
      multiViewThumbnails: true,
      alphaThumbnail: true
    }));

    expect(taskId).toMatch(/^meshy-multiview:/u);
    expect(loadedAssetIds).toEqual(["front-image", "left-image", "right-image"]);
    expect(calls[0]).toMatchObject({
      url: "https://api.meshy.ai/openapi/v1/multi-image-to-3d",
      body: {
        image_urls: [
          `data:image/jpeg;base64,${Buffer.from("front-image").toString("base64")}`,
          `data:image/jpeg;base64,${Buffer.from("left-image").toString("base64")}`,
          `data:image/jpeg;base64,${Buffer.from("right-image").toString("base64")}`
        ],
        ai_model: "meshy-7",
        should_texture: true,
        enable_pbr: true,
        texture_prompt: "painted metal",
        should_remesh: true,
        topology: "quad",
        target_polycount: 30_000,
        image_enhancement: false,
        remove_lighting: false,
        target_formats: ["glb"],
        auto_size: true,
        origin_at: "center",
        multi_view_thumbnails: true,
        alpha_thumbnail: true
      }
    });
    expect(calls[0]?.body).not.toHaveProperty("model_type");
    expect(calls[0]?.body).not.toHaveProperty("ultra_mode");

    expect(await provider.query(taskId)).toMatchObject({
      status: "succeeded",
      modelUrls: { glb: "https://assets.example/multi.glb" }
    });
    expect(calls[1]?.url).toBe(
      "https://api.meshy.ai/openapi/v1/multi-image-to-3d/meshy-multi-task"
    );
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

  it("submits Tripo multi-view inputs in front-left-back-right order", async () => {
    const taskBodies: Record<string, unknown>[] = [];
    let uploadCount = 0;
    const provider = new TripoModelProvider({
      baseUrl: "https://api.tripo3d.ai/v2/openapi",
      apiKey: "tripo-secret",
      model: "P1-20260311",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/upload/sts")) {
          uploadCount += 1;
          return Response.json({ code: 0, data: { image_token: `token-${uploadCount}` } });
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        taskBodies.push(body);
        return Response.json({ code: 0, data: { task_id: "multiview-task" } });
      })
    });

    await provider.submit(multiViewRequest({
      targetFaceCount: 4_000,
      modelSeed: 12,
      textureSeed: 34,
      textureAlignment: "geometry",
      autoSize: true,
      exportUv: false,
      compression: "geometry"
    }));

    expect(uploadCount).toBe(3);
    expect(taskBodies[0]).toMatchObject({
      type: "multiview_to_model",
      model_version: "P1-20260311",
      files: [
        { type: "jpg", file_token: "token-1" },
        { type: "jpg", file_token: "token-2" },
        {},
        { type: "jpg", file_token: "token-3" }
      ],
      face_limit: 4_000,
      model_seed: 12,
      texture_seed: 34,
      texture_alignment: "geometry",
      auto_size: true,
      export_uv: false,
      compress: "geometry"
    });
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

  it("converts Tripo quad FBX output back to GLB for web preview", async () => {
    const taskBodies: Record<string, unknown>[] = [];
    const provider = new TripoModelProvider({
      baseUrl: "https://api.tripo3d.ai/v2/openapi",
      apiKey: "tripo-secret",
      model: "v3.1-20260211",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as Record<string, unknown>
          : undefined;
        if (body) taskBodies.push(body);
        if (url.endsWith("/upload/sts")) {
          return Response.json({ code: 0, data: { image_token: "image-token" } });
        }
        if (body?.type === "image_to_model") {
          return Response.json({ code: 0, data: { task_id: "quad-task" } });
        }
        if (url.endsWith("/task/quad-task")) {
          return Response.json({
            code: 0,
            data: {
              status: "success",
              progress: 100,
              output: { model: "https://assets.example/quad.fbx" }
            }
          });
        }
        if (body?.type === "convert_model") {
          return Response.json({ code: 0, data: { task_id: "quad-glb-task" } });
        }
        return Response.json({
          code: 0,
          data: {
            status: "success",
            progress: 100,
            output: { model: "https://assets.example/quad.glb" }
          }
        });
      })
    });

    const modelRequest = request(["glb"], {
      quad: true,
      targetFaceCount: 10_000,
      geometryQuality: "standard"
    });
    const taskId = await provider.submit(modelRequest);
    const converting = await provider.query(taskId);
    expect(converting.status).toBe("running");
    expect(taskBodies).toContainEqual(expect.objectContaining({
      type: "convert_model",
      format: "GLB",
      original_model_task_id: "quad-task"
    }));
    const result = await provider.query(converting.nextExternalTaskId!);
    expect(result).toMatchObject({
      status: "succeeded",
      modelUrls: {
        fbx: "https://assets.example/quad.fbx",
        glb: "https://assets.example/quad.glb"
      }
    });
  });

  it("uses Hunyuan API Key endpoints and reads the GLB result", async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const provider = new HunyuanModelProvider({
      baseUrl: "https://tokenhub.tencentmaas.com",
      apiKey: "sk-hunyuan",
      model: "hy-3d-3.1",
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
        if (url.endsWith("/v1/api/3d/submit")) {
          return Response.json({
            id: "hunyuan-task",
            request_id: "request-1",
            object: "3d_job",
            status: "queued"
          });
        }
        return Response.json({
          status: "completed",
          data: [
            {
              type: "glb",
              url: "https://assets.example/model.glb",
              preview_image_url: "https://assets.example/model.png"
            }
          ],
          request_id: "request-2"
        });
      })
    });

    const modelRequest = request(["glb"]);
    const taskId = await provider.submit(modelRequest);
    expect(taskId).toBe("tokenhub:hunyuan-task");
    expect(calls[0]?.url).toBe("https://tokenhub.tencentmaas.com/v1/api/3d/submit");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk-hunyuan");
    expect(calls[0]?.body).toMatchObject({
      model: "hy-3d-3.1",
      image_base64: inputImage.toString("base64"),
      generate_type: "normal",
      enable_pbr: true,
      face_count: 100_000
    });
    expect(calls[0]?.body).not.toHaveProperty("__lyra");
    const result = await provider.query(taskId);
    expect(result).toMatchObject({
      status: "succeeded",
      modelUrls: { glb: "https://assets.example/model.glb" },
      previewUrl: "https://assets.example/model.png",
      providerState: { requestId: "request-2" }
    });
    expect(calls[1]?.url).toBe("https://tokenhub.tencentmaas.com/v1/api/3d/query");
    expect(calls[1]?.body).toEqual({ model: "hy-3d-3.1", id: "hunyuan-task" });
    expect((await provider.download(result, modelRequest))[0]?.data).toEqual(glb);
  });

  it("automatically falls back to the legacy Hunyuan API for an old API key", async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const provider = new HunyuanModelProvider({
      baseUrl: "https://tokenhub.tencentmaas.com",
      apiKey: "legacy-hunyuan-key",
      model: "hy-3d-3.0",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ url, headers, body });
        if (url.endsWith("/v1/api/3d/submit")) {
          return Response.json(
            { error: { message: "invalid token" } },
            { status: 401 }
          );
        }
        if (url.endsWith("/v1/ai3d/submit")) {
          return Response.json({ JobId: "legacy-task" });
        }
        return Response.json({
          Status: "DONE",
          ResultFile3Ds: [
            {
              Type: "GLB",
              Url: "https://assets.example/legacy.glb",
              PreviewImageUrl: "https://assets.example/legacy.png"
            }
          ],
          ResultCreditConsumed: 1,
          ResultCreditDetails: "legacy-credit"
        });
      })
    });

    const modelRequest = request(["glb"]);
    const taskId = await provider.submit(modelRequest);
    expect(taskId).toBe("legacy:legacy-task");
    expect(calls.map((call) => call.url)).toEqual([
      "https://tokenhub.tencentmaas.com/v1/api/3d/submit",
      "https://api.ai3d.cloud.tencent.com/v1/ai3d/submit"
    ]);
    expect(calls[1]?.headers.get("authorization")).toBe("legacy-hunyuan-key");
    expect(calls[1]?.body).toMatchObject({
      Model: "3.0",
      ImageUrl: {
        Url: `data:image/jpeg;base64,${inputImage.toString("base64")}`
      },
      GenerateType: "Normal",
      EnablePBR: true,
      FaceCount: 100_000
    });

    const result = await provider.query(taskId);
    expect(calls[2]?.url).toBe("https://api.ai3d.cloud.tencent.com/v1/ai3d/query");
    expect(calls[2]?.body).toEqual({ JobId: "legacy-task" });
    expect(result).toMatchObject({
      status: "succeeded",
      modelUrls: { glb: "https://assets.example/legacy.glb" },
      previewUrl: "https://assets.example/legacy.png",
      consumedCredits: 1,
      providerState: { creditDetails: "legacy-credit" }
    });
  });

  it("submits Hunyuan 3.1 multi-view images with official view names", async () => {
    let submitted: Record<string, unknown> | null = null;
    const provider = new HunyuanModelProvider({
      baseUrl: "https://tokenhub.tencentmaas.com",
      apiKey: "sk-hunyuan",
      model: "hy-3d-3.1",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "hunyuan-multiview", status: "queued" });
      })
    });

    await provider.submit({
      ...multiViewRequest({
        generateType: "Normal",
        pbr: false,
        targetFaceCount: 500_000
      }),
      multiViewImageAssetIds: {
        front: "front-image",
        left: "left-image",
        back: "back-image",
        top: "top-image",
        rightFront: "right-front-image"
      }
    });

    expect(submitted).toMatchObject({
      model: "hy-3d-3.1",
      generate_type: "normal",
      enable_pbr: false,
      image_base64: inputImage.toString("base64"),
      multi_view_images: [
        { view: "left", image: inputImage.toString("base64") },
        { view: "back", image: inputImage.toString("base64") },
        { view: "top", image: inputImage.toString("base64") },
        { view: "right_front", image: inputImage.toString("base64") }
      ]
    });
  });

  it("creates Meshy text-to-model preview tasks", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const provider = new MeshyModelProvider({
      baseUrl: "https://api.meshy.ai",
      apiKey: "meshy-secret",
      model: "meshy-6",
      assetLoader: loader,
      client: httpClient(async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as Record<string, unknown>
          : undefined;
        calls.push({ url, ...(body ? { body } : {}) });
        if (init?.method === "POST") return Response.json({ result: "preview-task" });
        return Response.json({
          status: "SUCCEEDED",
          progress: 100,
          model_urls: { glb: "https://assets.example/text.glb" }
        });
      })
    });

    const taskId = await provider.submit(textRequest({ texture: false, pbr: false }));
    expect(taskId).toMatch(/^meshy-text:/u);
    expect(calls[0]).toMatchObject({
      url: "https://api.meshy.ai/openapi/v2/text-to-3d",
      body: {
        mode: "preview",
        prompt: "a low poly spaceship",
        ai_model: "meshy-6"
      }
    });
    expect(await provider.query(taskId)).toMatchObject({
      status: "succeeded",
      modelUrls: { glb: "https://assets.example/text.glb" }
    });
  });

  it("uses the Meshy 7 API defaults when optional values are omitted", async () => {
    let body: Record<string, unknown> | null = null;
    const provider = new MeshyModelProvider({
      baseUrl: "https://api.meshy.ai",
      apiKey: "meshy-secret",
      model: "meshy-7",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ result: "meshy-default-task" });
      })
    });

    await provider.submit({
      ...request(["glb"]),
      parameters: {}
    });
    expect(body).toMatchObject({
      model_type: "standard",
      ai_model: "meshy-7",
      should_texture: true,
      enable_pbr: false,
      texture_resolution: "2k",
      should_remesh: false,
      image_enhancement: true,
      moderation: false,
      auto_size: false,
      alpha_thumbnail: false
    });
    expect(body).not.toHaveProperty("target_polycount");
    expect(body).not.toHaveProperty("topology");
  });

  it("supports Meshy 7 Ultra Mode for image and text tasks", async () => {
    const bodies: Record<string, unknown>[] = [];
    const provider = new MeshyModelProvider({
      baseUrl: "https://api.meshy.ai",
      apiKey: "meshy-secret",
      model: "meshy-7",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ result: "meshy-7-task" });
      })
    });

    await provider.submit(request(["glb"], { ultraMode: true }));
    expect(bodies[0]).toMatchObject({
      ai_model: "meshy-7",
      image_enhancement: true,
      ultra_mode: true
    });
    expect(bodies[0]).not.toHaveProperty("remove_lighting");

    await provider.submit(textRequest({ texture: false, pbr: false, ultraMode: true }));
    expect(bodies[1]).toMatchObject({
      mode: "preview",
      ai_model: "meshy-7",
      ultra_mode: true
    });
  });

  it("supports Meshy T2 smart topology for text generation", async () => {
    let body: Record<string, unknown> | null = null;
    const provider = new MeshyModelProvider({
      baseUrl: "https://api.meshy.ai",
      apiKey: "meshy-secret",
      model: "meshy-t2",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ result: "meshy-t2-task" });
      })
    });

    await provider.submit(textRequest({
      texture: false,
      pbr: false,
      remesh: false,
      targetFaceCount: 4_000
    }));
    expect(body).toMatchObject({
      mode: "preview",
      model_type: "smart-topology",
      ai_model: "meshy-t2",
      target_polycount: 4_000
    });
  });

  it("creates Tripo and Hunyuan text-to-model tasks without uploading an image", async () => {
    const tripoBodies: Record<string, unknown>[] = [];
    const tripo = new TripoModelProvider({
      baseUrl: "https://api.tripo3d.ai/v2/openapi",
      apiKey: "tripo-secret",
      model: "P1-20260311",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        tripoBodies.push(body);
        return Response.json({ code: 0, data: { task_id: "tripo-text-task" } });
      })
    });
    await tripo.submit(textRequest());
    expect(tripoBodies).toEqual([
      expect.objectContaining({
        type: "text_to_model",
        prompt: "a low poly spaceship"
      })
    ]);

    const hunyuanBodies: Record<string, unknown>[] = [];
    const hunyuan = new HunyuanModelProvider({
      baseUrl: "https://tokenhub.tencentmaas.com",
      apiKey: "hunyuan-secret",
      model: "hy-3d-3.1",
      assetLoader: loader,
      client: httpClient(async (_input, init) => {
        hunyuanBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ id: "hunyuan-text-task", status: "queued" });
      })
    });
    await hunyuan.submit(textRequest());
    expect(hunyuanBodies[0]).toMatchObject({
      prompt: "a low poly spaceship",
      model: "hy-3d-3.1"
    });
    expect(hunyuanBodies[0]).not.toHaveProperty("image_url");
  });
});

function request(
  outputFormats: ModelOutputFormat[],
  parameterOverrides: Record<string, unknown> = {}
): ModelGenerationRequest {
  return {
    projectId: "project",
    inputMode: "image",
    inputImageAssetId: "image",
    providerProfileId: "profile",
    providerModelId: "model",
    outputFormats,
    parameters: {
      texture: true,
      pbr: true,
      remesh: true,
      targetFaceCount: 100_000,
      ...parameterOverrides
    },
    source: "manual"
  };
}

function textRequest(
  parameterOverrides: Record<string, unknown> = {}
): ModelGenerationRequest {
  return {
    projectId: "project",
    inputMode: "text",
    prompt: "a low poly spaceship",
    providerProfileId: "profile",
    providerModelId: "model",
    outputFormats: ["glb"],
    parameters: {
      texture: true,
      pbr: true,
      remesh: true,
      targetFaceCount: 20_000,
      ...parameterOverrides
    },
    source: "manual"
  };
}

function multiViewRequest(
  parameterOverrides: Record<string, unknown> = {}
): ModelGenerationRequest {
  return {
    projectId: "project",
    inputMode: "multiview",
    multiViewImageAssetIds: {
      front: "front-image",
      left: "left-image",
      right: "right-image"
    },
    providerProfileId: "profile",
    providerModelId: "model",
    outputFormats: ["glb"],
    parameters: {
      texture: true,
      pbr: true,
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
