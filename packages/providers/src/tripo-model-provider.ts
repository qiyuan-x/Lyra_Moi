import type { ModelGenerationRequest, ModelOutputFormat } from "@lyra/contracts";
import {
  normalizeTripoBaseUrl,
  tripoModelFamily,
  tripoFaceRange,
  isMultiViewToModelGenerationRequest,
  isTextToModelGenerationRequest
} from "@lyra/contracts";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import {
  normalizeProgress,
  readBoolean,
  readEnum,
  readNullableInteger,
  requireModelInput,
  requireModelPrompt,
  requireRecord,
  requireText,
  type BinaryModelProvider,
  type ModelProviderAssetLoader,
  type ModelProviderResult
} from "./model-provider-types.js";
import {
  downloadGeneratedModels,
  providerFailure,
  readOptionalText,
  stripInternalProviderSettings
} from "./model-provider-utils.js";

export interface TripoModelProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  assetLoader: ModelProviderAssetLoader;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class TripoModelProvider implements BinaryModelProvider {
  readonly #baseUrl: string;
  readonly #v3: boolean;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ModelProviderAssetLoader;
  readonly #settings: Record<string, unknown>;
  readonly #client: ProviderHttpClient;

  constructor(options: TripoModelProviderOptions) {
    this.#baseUrl = normalizeTripoBaseUrl(requireText(options.baseUrl, "Tripo Base URL is required."));
    this.#v3 = new URL(this.#baseUrl).pathname.endsWith("/v3");
    this.#apiKey = requireText(options.apiKey, "Tripo API key is required.");
    this.#model = requireText(options.model, "Tripo model is required.");
    this.#assetLoader = options.assetLoader;
    this.#settings = stripInternalProviderSettings(options.settings ?? {});
    if (this.#v3) {
      for (const key of ["type", "model_version", "file", "files", "original_model_task_id"]) {
        delete this.#settings[key];
      }
    }
    this.#client = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const outputFormats = normalizeOutputFormats(request.outputFormats);
    const parameters = parseTripoParameters(request, this.#model);
    const commonParameters = createTripoGenerationParameters(parameters);
    if (this.#v3 && this.#model.startsWith("Turbo-")) {
      throw new Error("Tripo V3 文档未列出 Turbo 模型，请重新测试连通性并选择 H 或 P 系列模型。");
    }
    if (this.#v3 && tripoModelFamily(this.#model) === "h2") {
      for (const key of ["texture_quality", "geometry_quality", "auto_size", "quad", "smart_low_poly", "generate_parts", "compress"]) {
        delete commonParameters[key];
      }
    }
    if (this.#v3 && ["p1", "p2"].includes(tripoModelFamily(this.#model))) {
      delete commonParameters.compress;
    }
    if (isTextToModelGenerationRequest(request)) {
      const prompt = requireModelPrompt(request);
      if (prompt.length > 1024) {
        throw new Error("Tripo text-to-model prompt cannot exceed 1024 characters.");
      }
      const task = this.#unwrap(await this.#client.postJson(
        `${this.#baseUrl}/${this.#v3 ? "generation/text-to-model" : "task"}`,
        this.#headers(),
        {
          ...this.#settings,
          ...(this.#v3 ? {} : { type: "text_to_model" }),
          ...(this.#v3 ? { model: this.#model } : { model_version: this.#model }),
          prompt,
          ...(parameters.negativePrompt ? { negative_prompt: parameters.negativePrompt } : {}),
          ...(parameters.imageSeed === null ? {} : { image_seed: parameters.imageSeed }),
          ...commonParameters
        },
        signal
      ));
      return encodeCheckpoint({
        stage: "generation",
        taskId: requireText(task.task_id, "Tripo did not return a task ID."),
        outputFormats,
        quad: parameters.quad
      });
    }
    if (isMultiViewToModelGenerationRequest(request)) {
      if (!request.multiViewImageAssetIds.front ||
          ["front", "left", "back", "right"].filter((view) =>
            request.multiViewImageAssetIds[view as keyof typeof request.multiViewImageAssetIds]).length < 2) {
        throw new Error("Tripo 多视图生成至少需要两张图片，且必须包含正面图。");
      }
      const files: Array<Record<string, string>> = [];
      for (const view of ["front", "left", "back", "right"] as const) {
        const assetId = request.multiViewImageAssetIds[view];
        files.push(assetId
          ? await this.#uploadImage(assetId, request.projectId, signal)
          : {});
      }
      const task = this.#unwrap(await this.#client.postJson(
        `${this.#baseUrl}/${this.#v3 ? "generation/multiview-to-model" : "task"}`,
        this.#headers(),
        {
          ...this.#settings,
          ...(this.#v3 ? {} : { type: "multiview_to_model" }),
          ...(this.#v3 ? { model: this.#model } : { model_version: this.#model }),
          ...(this.#v3 ? { inputs: files.map((file) => file.file_token ?? "") } : { files }),
          ...commonParameters,
          texture_alignment: parameters.textureAlignment,
          orientation: parameters.orientation
        },
        signal
      ));
      return encodeCheckpoint({
        stage: "generation",
        taskId: requireText(task.task_id, "Tripo did not return a task ID."),
        outputFormats,
        quad: parameters.quad
      });
    }
    const input = requireModelInput(request);
    const file = await this.#uploadImage(input.assetId, input.projectId, signal);
    const task = this.#unwrap(await this.#client.postJson(
      `${this.#baseUrl}/${this.#v3 ? "generation/image-to-model" : "task"}`,
      this.#headers(),
      {
        ...this.#settings,
        ...(this.#v3 ? {} : { type: "image_to_model" }),
        ...(this.#v3 ? { model: this.#model } : { model_version: this.#model }),
        ...(this.#v3 ? { input: file.file_token } : { file }),
        ...commonParameters,
        enable_image_autofix: parameters.imageAutofix,
        texture_alignment: parameters.textureAlignment,
        orientation: parameters.orientation,
      },
      signal
    ));
    return encodeCheckpoint({
      stage: "generation",
      taskId: requireText(task.task_id, "Tripo did not return a task ID."),
      outputFormats,
      quad: parameters.quad
    });
  }

  async #uploadImage(
    assetId: string,
    projectId: string,
    signal?: AbortSignal
  ): Promise<{ type: string; file_token: string }> {
    const image = await this.#assetLoader.loadModelInput(assetId, projectId);
    const type = tripoImageType(image.mimeType);
    if (image.data.byteLength > (this.#v3 ? 20 : 10) * 1024 * 1024) {
      throw new Error(`Tripo uploaded input image cannot exceed ${this.#v3 ? 20 : 10} MB.`);
    }
    const upload = new FormData();
    upload.append(
      "file",
      new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
      image.name
    );
    const uploadBody = this.#unwrap(await this.#client.postMultipart(
      `${this.#baseUrl}/${this.#v3 ? "files" : "upload/sts"}`,
      this.#headers(),
      upload,
      signal
    ));
    return {
      type,
      file_token: requireText(
        uploadBody.image_token ?? uploadBody.file_token,
        "Tripo did not return an image token."
      )
    };
  }

  async query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult> {
    const checkpoint = decodeCheckpoint(externalTaskId);
    if (checkpoint.stage === "conversions") {
      return this.#queryConversions(checkpoint, externalTaskId, signal);
    }
    const body = await this.#queryTask(checkpoint.taskId, signal);
    const status = typeof body.status === "string" ? body.status.toLowerCase() : "";
    const progress = normalizeProgress(body.progress, status === "queued" ? 0 : 10);
    if (status === "queued") return { status: "pending", progress };
    if (status === "running") return { status: "running", progress };
    if (status !== "success") {
      if (["failed", "banned", "expired", "cancelled", "unknown"].includes(status)) {
        return providerFailure(
          readOptionalText(body.error_message ?? body.message) ?? `Tripo task ended with status ${status}.`
        );
      }
      throw new ProviderConnectionError("INVALID_RESPONSE", "Tripo returned an unknown task status.");
    }
    const output = requireRecord(body.output, "Tripo model output is missing.");
    const generatedModelUrl = requireText(
        output.model_url ?? output.pbr_model ?? output.model ?? output.base_model,
        "Tripo did not return a model URL."
      );
    const extension = new URL(generatedModelUrl).pathname.split(".").pop()?.toLowerCase();
    const generatedFormat: ModelOutputFormat = isModelOutputFormat(extension)
      ? extension : checkpoint.quad ? "fbx" : "glb";
    const modelUrls: Partial<Record<ModelOutputFormat, string>> = { [generatedFormat]: generatedModelUrl };
    const previewUrl = readOptionalText(output.rendered_image_url ?? output.rendered_image);
    const conversionFormats = checkpoint.outputFormats.filter((format) => format !== generatedFormat);
    if (conversionFormats.length === 0) {
      return {
        status: "succeeded",
        progress: 100,
        modelUrls,
        ...(previewUrl ? { previewUrl } : {})
      };
    }

    const conversionTasks: Partial<Record<ModelOutputFormat, string>> = {};
    for (const format of conversionFormats) {
      const conversion = this.#unwrap(await this.#client.postJson(
        `${this.#baseUrl}/${this.#v3 ? "models/convert" : "task"}`,
        this.#headers(),
        {
          ...(this.#v3 ? {} : { type: "convert_model" }),
          format: format.toUpperCase(),
          ...(this.#v3 ? { input: checkpoint.taskId } : { original_model_task_id: checkpoint.taskId })
        },
        signal
      ));
      conversionTasks[format] = requireText(
        conversion.task_id,
        `Tripo did not return a ${format.toUpperCase()} conversion task ID.`
      );
    }
    const nextExternalTaskId = encodeCheckpoint({
      stage: "conversions",
      tasks: conversionTasks,
      modelUrls,
      ...(previewUrl ? { previewUrl } : {})
    });
    return {
      status: "running",
      progress: 70,
      nextExternalTaskId,
      providerState: {
        stage: "converting",
        outputFormats: checkpoint.outputFormats
      }
    };
  }

  async #queryConversions(
    checkpoint: ConversionCheckpoint,
    externalTaskId: string,
    signal?: AbortSignal
  ): Promise<ModelProviderResult> {
    const modelUrls: Partial<Record<ModelOutputFormat, string>> = {
      ...checkpoint.modelUrls
    };
    let completed = 0;
    let progress = 70;
    for (const [format, taskId] of Object.entries(checkpoint.tasks) as Array<
      [ModelOutputFormat, string | undefined]
    >) {
      if (!taskId) continue;
      const body = await this.#queryTask(taskId, signal);
      const status = typeof body.status === "string" ? body.status.toLowerCase() : "";
      if (status === "queued" || status === "running") {
        progress = Math.max(progress, normalizeProgress(body.progress, 70));
        continue;
      }
      if (status !== "success") {
        if (["failed", "banned", "expired", "cancelled", "unknown"].includes(status)) {
          return providerFailure(
            readOptionalText(body.error_message ?? body.message) ?? `Tripo conversion ended with status ${status}.`
          );
        }
        throw new ProviderConnectionError(
          "INVALID_RESPONSE",
          "Tripo returned an unknown conversion task status."
        );
      }
      const output = requireRecord(body.output, "Tripo conversion output is missing.");
      modelUrls[format] = requireText(
        output.model_url ?? output.model ?? output.base_model ?? output.pbr_model,
        `Tripo did not return a ${format.toUpperCase()} model URL.`
      );
      completed += 1;
    }
    const total = Object.keys(checkpoint.tasks).length;
    if (completed < total) {
      return {
        status: "running",
        progress: Math.min(99, Math.max(progress, 70 + Math.round((completed / total) * 25))),
        nextExternalTaskId: externalTaskId,
        providerState: { stage: "converting", completed, total }
      };
    }
    return {
      status: "succeeded",
      progress: 100,
      modelUrls,
      ...(checkpoint.previewUrl ? { previewUrl: checkpoint.previewUrl } : {})
    };
  }

  async #queryTask(taskId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.#unwrap(await this.#client.getJson(
      `${this.#baseUrl}/${this.#v3 ? "tasks" : "task"}/${encodeURIComponent(taskId)}`,
      this.#headers(),
      signal
    ));
  }

  download(
    result: ModelProviderResult,
    request: ModelGenerationRequest,
    signal?: AbortSignal
  ) {
    return downloadGeneratedModels(
      this.#client,
      result,
      request,
      `tripo-${Date.now()}`,
      signal
    );
  }

  #unwrap(value: unknown): Record<string, unknown> {
    const response = requireRecord(value);
    if (response.code !== 0) {
      const message = readOptionalText(response.message) ?? "Tripo request failed.";
      throw new ProviderConnectionError(
        !this.#v3 && response.code === 1004 ? "AUTHENTICATION_FAILED" : "BAD_REQUEST",
        message
      );
    }
    return requireRecord(response.data, "Tripo response data is missing.");
  }

  #headers(): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.#apiKey}`
    };
  }
}

type GenerationCheckpoint = {
  stage: "generation";
  taskId: string;
  outputFormats: ModelOutputFormat[];
  quad: boolean;
};

type ConversionCheckpoint = {
  stage: "conversions";
  tasks: Partial<Record<ModelOutputFormat, string>>;
  modelUrls: Partial<Record<ModelOutputFormat, string>>;
  previewUrl?: string;
};

type TripoCheckpoint = GenerationCheckpoint | ConversionCheckpoint;

function normalizeOutputFormats(formats: readonly ModelOutputFormat[]): ModelOutputFormat[] {
  const requested = [...new Set(formats)];
  const supported = new Set<ModelOutputFormat>([
    "glb",
    "obj",
    "fbx",
    "stl",
    "usdz",
    "3mf"
  ]);
  if (requested.length === 0 || requested.some((format) => !supported.has(format))) {
    throw new Error("Tripo requires at least one supported output format.");
  }
  return [...new Set<ModelOutputFormat>(["glb", ...requested])];
}

function encodeCheckpoint(value: TripoCheckpoint): string {
  return `tripo:${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeCheckpoint(value: string): TripoCheckpoint {
  if (!value.startsWith("tripo:")) {
    return { stage: "generation", taskId: value, outputFormats: ["glb"], quad: false };
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice("tripo:".length), "base64url").toString("utf8")
    );
    if (
      isRecord(parsed) &&
      parsed.stage === "generation" &&
      typeof parsed.taskId === "string" &&
      Array.isArray(parsed.outputFormats)
    ) {
      return {
        stage: "generation",
        taskId: parsed.taskId,
        outputFormats: parsed.outputFormats.filter(isModelOutputFormat),
        quad: parsed.quad === true
      };
    }
    if (
      isRecord(parsed) &&
      parsed.stage === "conversions" &&
      isRecord(parsed.tasks) &&
      isRecord(parsed.modelUrls)
    ) {
      const tasks: Partial<Record<ModelOutputFormat, string>> = {};
      for (const format of Object.keys(parsed.tasks)) {
        if (isModelOutputFormat(format) && typeof parsed.tasks[format] === "string") {
          tasks[format] = parsed.tasks[format] as string;
        }
      }
      const modelUrls: Partial<Record<ModelOutputFormat, string>> = {};
      for (const format of Object.keys(parsed.modelUrls)) {
        if (isModelOutputFormat(format) && typeof parsed.modelUrls[format] === "string") {
          modelUrls[format] = parsed.modelUrls[format] as string;
        }
      }
      return {
        stage: "conversions",
        tasks,
        modelUrls,
        ...(typeof parsed.previewUrl === "string" ? { previewUrl: parsed.previewUrl } : {})
      };
    }
  } catch {
    // Fall through to the legacy plain task ID.
  }
  return { stage: "generation", taskId: value, outputFormats: ["glb"], quad: false };
}

function isModelOutputFormat(value: unknown): value is ModelOutputFormat {
  return typeof value === "string" &&
    ["glb", "obj", "fbx", "stl", "usdz", "3mf"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTripoParameters(request: ModelGenerationRequest, model: string) {
  const values = request.parameters;
  const family = tripoModelFamily(model);
  const p1 = family === "p1";
  const pSeries = p1 || family === "p2";
  const supportsGeometryQuality = family === "h3";
  const texture = readBoolean(values, "texture", true);
  const pbr = readBoolean(values, "pbr", true);
  if (pbr && !texture) throw new Error("Tripo PBR requires texture generation.");
  const quad = !p1 && readBoolean(values, "quad", false);
  const smartLowPoly = !pSeries && readBoolean(values, "smartLowPoly", false);
  const generateParts = !pSeries && readBoolean(values, "generateParts", false);
  if (generateParts && (texture || pbr || quad || smartLowPoly)) {
    throw new Error("Tripo part generation requires texture, PBR, quad output, and smart low-poly to be disabled.");
  }
  const geometryQuality = supportsGeometryQuality
    ? readEnum(values, "geometryQuality", ["standard", "detailed"], "standard")
    : null;
  const faceLimit = readNullableInteger(values, "targetFaceCount");
  const { minimum, maximum } = tripoFaceRange(model, { geometryQuality, quad, smartLowPoly });
  if (faceLimit !== null && (faceLimit < minimum || faceLimit > maximum)) {
    throw new Error(`Tripo target face count must be between ${minimum} and ${maximum}.`);
  }
  const negativePrompt = readOptionalText(values.negativePrompt) ?? "";
  if (negativePrompt.length > 255) {
    throw new Error("Tripo negative prompt cannot exceed 255 characters.");
  }
  return {
    texture,
    pbr,
    faceLimit,
    geometryQuality,
    quad,
    smartLowPoly,
    generateParts,
    textureQuality: readEnum(
      values,
      "textureQuality",
      ["standard", "detailed", "extreme"],
      "standard"
    ),
    imageAutofix: readBoolean(values, "imageAutofix", false),
    textureAlignment: readEnum(
      values,
      "textureAlignment",
      ["original_image", "geometry"],
      "original_image"
    ),
    orientation: readEnum(
      values,
      "orientation",
      ["default", "align_image"],
      "default"
    ),
    autoSize: readBoolean(values, "autoSize", false),
    exportUv: readBoolean(values, "exportUv", true),
    compression: readEnum(values, "compression", ["default", "geometry"], "default"),
    modelSeed: readNullableInteger(values, "modelSeed"),
    textureSeed: readNullableInteger(values, "textureSeed"),
    imageSeed: readNullableInteger(values, "imageSeed"),
    negativePrompt
  };
}

type TripoParameters = ReturnType<typeof parseTripoParameters>;

export function createTripoGenerationParameters(parameters: TripoParameters): Record<string, unknown> {
  return {
    texture: parameters.texture,
    pbr: parameters.pbr,
    ...(parameters.faceLimit === null ? {} : { face_limit: parameters.faceLimit }),
    ...(parameters.texture
      ? {
          texture_quality: parameters.textureQuality,
          ...(parameters.textureSeed === null ? {} : { texture_seed: parameters.textureSeed })
        }
      : {}),
    ...(parameters.geometryQuality
      ? { geometry_quality: parameters.geometryQuality }
      : {}),
    ...(parameters.modelSeed === null ? {} : { model_seed: parameters.modelSeed }),
    auto_size: parameters.autoSize,
    export_uv: parameters.exportUv,
    ...(parameters.compression === "geometry" ? { compress: "geometry" } : {}),
    ...(parameters.quad ? { quad: true } : {}),
    ...(parameters.smartLowPoly ? { smart_low_poly: true } : {}),
    ...(parameters.generateParts ? { generate_parts: true } : {})
  };
}

function tripoImageType(mimeType: string): "jpg" | "png" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  throw new Error("Tripo input images must use JPEG or PNG format.");
}
