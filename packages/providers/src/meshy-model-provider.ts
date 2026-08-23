import type {
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import { isTextToModelGenerationRequest } from "@lyra/contracts";
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
  type ModelProviderResult,
  type ModelTextureUrlSet
} from "./model-provider-types.js";
import {
  downloadGeneratedModels,
  providerFailure,
  readOptionalNumber,
  readOptionalText,
  stripInternalProviderSettings
} from "./model-provider-utils.js";

export interface MeshyModelProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  assetLoader: ModelProviderAssetLoader;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class MeshyModelProvider implements BinaryModelProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ModelProviderAssetLoader;
  readonly #settings: Record<string, unknown>;
  readonly #client: ProviderHttpClient;

  constructor(options: MeshyModelProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Meshy Base URL is required.").replace(/\/+$/u, "");
    this.#apiKey = requireText(options.apiKey, "Meshy API key is required.");
    this.#model = requireText(options.model, "Meshy model is required.");
    this.#assetLoader = options.assetLoader;
    this.#settings = stripInternalProviderSettings(options.settings ?? {});
    this.#client = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const parameters = parseMeshyParameters(request, this.#model);
    if (isTextToModelGenerationRequest(request)) {
      return this.#submitTextPreview(request, parameters, signal);
    }
    const input = requireModelInput(request);
    const image = await this.#assetLoader.loadModelInput(input.assetId, input.projectId);
    if (request.textureImageAssetId && !parameters.texture) {
      throw new Error("Meshy texture generation must be enabled to use a texture reference image.");
    }
    const textureImage = request.textureImageAssetId
      ? await this.#assetLoader.loadModelInput(request.textureImageAssetId, input.projectId)
      : null;
    const providerSettings = { ...this.#settings };
    delete providerSettings.texture_image_url;
    if (textureImage) delete providerSettings.texture_prompt;
    const body = requireRecord(await this.#client.postJson(
      `${this.#baseUrl}/openapi/v1/image-to-3d`,
      this.#headers(),
      {
        ...providerSettings,
        image_url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
        ...(textureImage
          ? {
              texture_image_url:
                `data:${textureImage.mimeType};base64,${textureImage.data.toString("base64")}`
            }
          : {}),
        model_type: parameters.modelType,
        ai_model: this.#model,
        should_texture: parameters.texture,
        enable_pbr: parameters.pbr,
        target_formats: request.outputFormats,
        texture_resolution: parameters.textureResolution,
        pose_mode: parameters.poseMode,
        ...(parameters.modelType === "standard"
          ? {
              should_remesh: parameters.shouldRemesh,
              topology: parameters.topology,
              ...(parameters.targetFaceCount === null
                ? {}
                : { target_polycount: parameters.targetFaceCount })
            }
          : parameters.targetFaceCount === null
            ? {}
            : { target_polycount: parameters.targetFaceCount }),
        ...(["latest", "meshy-6", "meshy-7"].includes(this.#model)
          ? { image_enhancement: parameters.imageEnhancement }
          : {}),
        ...(this.#model === "meshy-6"
          ? { remove_lighting: parameters.removeLighting }
          : {}),
        ...(["latest", "meshy-7"].includes(this.#model) && parameters.ultraMode
          ? { ultra_mode: true }
          : {})
      },
      signal
    ));
    return requireText(body.result, "Meshy did not return a task ID.");
  }

  async query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult> {
    const textCheckpoint = decodeTextCheckpoint(externalTaskId);
    if (textCheckpoint) {
      return this.#queryTextTask(textCheckpoint, signal);
    }
    const body = requireRecord(await this.#client.getJson(
      `${this.#baseUrl}/openapi/v1/image-to-3d/${encodeURIComponent(externalTaskId)}`,
      this.#headers(),
      signal
    ));
    const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
    const progress = normalizeProgress(body.progress, status === "PENDING" ? 0 : 10);
    if (status === "PENDING") return { status: "pending", progress };
    if (status === "IN_PROGRESS") return { status: "running", progress };
    if (status === "FAILED" || status === "CANCELED") {
      const taskError = typeof body.task_error === "object" && body.task_error !== null
        ? body.task_error as Record<string, unknown>
        : {};
      return providerFailure(
        readOptionalText(taskError.message) ?? `Meshy task ended with status ${status}.`
      );
    }
    if (status !== "SUCCEEDED") {
      throw new ProviderConnectionError("INVALID_RESPONSE", "Meshy returned an unknown task status.");
    }
    const rawUrls = requireRecord(body.model_urls, "Meshy model URLs are missing.");
    const modelUrls: Partial<Record<ModelOutputFormat, string>> = {};
    for (const format of ["glb", "obj", "fbx", "stl", "usdz", "3mf"] as const) {
      const url = readOptionalText(rawUrls[format]);
      if (url) modelUrls[format] = url;
    }
    const textureUrls = parseTextureUrls(body.texture_urls);
    return {
      status: "succeeded",
      progress: 100,
      modelUrls,
      ...(textureUrls.length > 0 ? { textureUrls } : {}),
      ...(readOptionalText(body.thumbnail_url)
        ? { previewUrl: readOptionalText(body.thumbnail_url)! }
        : {}),
      ...(readOptionalNumber(body.consumed_credits) === undefined
        ? {}
        : { consumedCredits: readOptionalNumber(body.consumed_credits)! })
    };
  }

  async #submitTextPreview(
    request: ModelGenerationRequest,
    parameters: ReturnType<typeof parseMeshyParameters>,
    signal?: AbortSignal
  ): Promise<string> {
    const prompt = requireModelPrompt(request);
    if (!["meshy-5", "meshy-6", "meshy-7", "latest"].includes(this.#model)) {
      throw new Error("The selected Meshy model does not support text-to-model generation.");
    }
    if (prompt.length > 600) {
      throw new Error("Meshy text-to-model prompt cannot exceed 600 characters.");
    }
    const providerSettings = { ...this.#settings };
    delete providerSettings.image_url;
    delete providerSettings.texture_image_url;
    delete providerSettings.texture_prompt;
    delete providerSettings.mode;
    delete providerSettings.preview_task_id;
    const body = requireRecord(await this.#client.postJson(
      `${this.#baseUrl}/openapi/v2/text-to-3d`,
      this.#headers(),
      {
        ...providerSettings,
        mode: "preview",
        prompt,
        model_type: parameters.modelType === "smart-topology"
          ? "standard"
          : parameters.modelType,
        ai_model: this.#model,
        ...(["latest", "meshy-7"].includes(this.#model) && parameters.ultraMode
          ? { ultra_mode: true }
          : {}),
        target_formats: request.outputFormats,
        pose_mode: parameters.poseMode,
        ...(parameters.modelType === "standard"
          ? {
              should_remesh: parameters.shouldRemesh,
              topology: parameters.topology,
              ...(parameters.targetFaceCount === null
                ? {}
                : { target_polycount: parameters.targetFaceCount })
            }
          : {})
      },
      signal
    ));
    return encodeTextCheckpoint({
      stage: "preview",
      taskId: requireText(body.result, "Meshy did not return a preview task ID."),
      refine: parameters.texture,
      projectId: request.projectId,
      ...(request.textureImageAssetId
        ? { textureImageAssetId: request.textureImageAssetId }
        : {}),
      outputFormats: request.outputFormats,
      pbr: parameters.pbr,
      textureResolution: parameters.textureResolution,
      removeLighting: parameters.removeLighting
    });
  }

  async #queryTextTask(
    checkpoint: MeshyTextCheckpoint,
    signal?: AbortSignal
  ): Promise<ModelProviderResult> {
    const body = requireRecord(await this.#client.getJson(
      `${this.#baseUrl}/openapi/v2/text-to-3d/${encodeURIComponent(checkpoint.taskId)}`,
      this.#headers(),
      signal
    ));
    const result = readMeshyTaskResult(body);
    if (result.status !== "succeeded") {
      const progress = checkpoint.stage === "refine"
        ? 50 + Math.round(result.progress * 0.5)
        : checkpoint.refine
          ? Math.round(result.progress * 0.5)
          : result.progress;
      return { ...result, progress };
    }
    if (checkpoint.stage === "preview" && checkpoint.refine) {
      const textureImage = checkpoint.textureImageAssetId
        ? await this.#assetLoader.loadModelInput(
            checkpoint.textureImageAssetId,
            checkpoint.projectId
          )
        : null;
      const providerSettings = { ...this.#settings };
      delete providerSettings.image_url;
      delete providerSettings.mode;
      delete providerSettings.preview_task_id;
      if (textureImage) delete providerSettings.texture_prompt;
      const refine = requireRecord(await this.#client.postJson(
        `${this.#baseUrl}/openapi/v2/text-to-3d`,
        this.#headers(),
        {
          ...providerSettings,
          mode: "refine",
          preview_task_id: checkpoint.taskId,
          ai_model: this.#model,
          enable_pbr: checkpoint.pbr,
          texture_resolution: checkpoint.textureResolution,
          ...(this.#model === "meshy-6"
            ? { remove_lighting: checkpoint.removeLighting }
            : {}),
          target_formats: checkpoint.outputFormats,
          ...(textureImage
            ? {
                texture_image_url:
                  `data:${textureImage.mimeType};base64,${textureImage.data.toString("base64")}`
              }
            : {})
        },
        signal
      ));
      return {
        status: "running",
        progress: 50,
        nextExternalTaskId: encodeTextCheckpoint({
          ...checkpoint,
          stage: "refine",
          taskId: requireText(refine.result, "Meshy did not return a refine task ID.")
        }),
        providerState: { stage: "refining" }
      };
    }
    return checkpoint.stage === "refine"
      ? { ...result, progress: 100 }
      : result;
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
      `meshy-${Date.now()}`,
      signal
    );
  }

  #headers(): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.#apiKey}`
    };
  }
}

interface MeshyTextCheckpoint {
  stage: "preview" | "refine";
  taskId: string;
  refine: boolean;
  projectId: string;
  textureImageAssetId?: string;
  outputFormats: ModelOutputFormat[];
  pbr: boolean;
  textureResolution: string;
  removeLighting: boolean;
}

function encodeTextCheckpoint(checkpoint: MeshyTextCheckpoint): string {
  return `meshy-text:${Buffer.from(
    JSON.stringify(checkpoint),
    "utf8"
  ).toString("base64url")}`;
}

function decodeTextCheckpoint(value: string): MeshyTextCheckpoint | null {
  if (!value.startsWith("meshy-text:")) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice("meshy-text:".length), "base64url").toString("utf8")
    );
    if (
      isRecord(parsed) &&
      (parsed.stage === "preview" || parsed.stage === "refine") &&
      typeof parsed.taskId === "string" &&
      typeof parsed.refine === "boolean" &&
      typeof parsed.projectId === "string" &&
      Array.isArray(parsed.outputFormats) &&
      typeof parsed.pbr === "boolean" &&
      typeof parsed.textureResolution === "string" &&
      typeof parsed.removeLighting === "boolean"
    ) {
      return {
        stage: parsed.stage,
        taskId: parsed.taskId,
        refine: parsed.refine,
        projectId: parsed.projectId,
        ...(typeof parsed.textureImageAssetId === "string"
          ? { textureImageAssetId: parsed.textureImageAssetId }
          : {}),
        outputFormats: parsed.outputFormats.filter(isModelOutputFormat),
        pbr: parsed.pbr,
        textureResolution: parsed.textureResolution,
        removeLighting: parsed.removeLighting
      };
    }
  } catch {
    return null;
  }
  return null;
}

function readMeshyTaskResult(body: Record<string, unknown>): ModelProviderResult {
  const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
  const progress = normalizeProgress(body.progress, status === "PENDING" ? 0 : 10);
  if (status === "PENDING") return { status: "pending", progress };
  if (status === "IN_PROGRESS") return { status: "running", progress };
  if (status === "FAILED" || status === "CANCELED") {
    const taskError = isRecord(body.task_error) ? body.task_error : {};
    return providerFailure(
      readOptionalText(taskError.message) ?? `Meshy task ended with status ${status}.`
    );
  }
  if (status !== "SUCCEEDED") {
    throw new ProviderConnectionError(
      "INVALID_RESPONSE",
      "Meshy returned an unknown task status."
    );
  }
  const rawUrls = requireRecord(body.model_urls, "Meshy model URLs are missing.");
  const modelUrls: Partial<Record<ModelOutputFormat, string>> = {};
  for (const format of ["glb", "obj", "fbx", "stl", "usdz", "3mf"] as const) {
    const url = readOptionalText(rawUrls[format]);
    if (url) modelUrls[format] = url;
  }
  const textureUrls = parseTextureUrls(body.texture_urls);
  return {
    status: "succeeded",
    progress: 100,
    modelUrls,
    ...(textureUrls.length > 0 ? { textureUrls } : {}),
    ...(readOptionalText(body.thumbnail_url)
      ? { previewUrl: readOptionalText(body.thumbnail_url)! }
      : {}),
    ...(readOptionalNumber(body.consumed_credits) === undefined
      ? {}
      : { consumedCredits: readOptionalNumber(body.consumed_credits)! })
  };
}

function parseTextureUrls(value: unknown): ModelTextureUrlSet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const parsed: ModelTextureUrlSet = {};
    for (const key of ["base_color", "metallic", "normal", "roughness", "emission"] as const) {
      const url = readOptionalText(record[key]);
      if (!url) continue;
      const target = key === "base_color" ? "baseColor" : key;
      parsed[target as keyof ModelTextureUrlSet] = url;
    }
    return Object.keys(parsed).length > 0 ? [parsed] : [];
  });
}

function isModelOutputFormat(value: unknown): value is ModelOutputFormat {
  return typeof value === "string" &&
    ["glb", "obj", "fbx", "stl", "usdz", "3mf"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMeshyParameters(request: ModelGenerationRequest, model: string) {
  const values = request.parameters;
  const modelType = model === "meshy-t1" || model === "meshy-t2"
    ? "smart-topology" as const
    : "standard" as const;
  const texture = readBoolean(values, "texture", true);
  const pbr = readBoolean(values, "pbr", true);
  if (pbr && !texture) throw new Error("Meshy PBR requires texture generation.");
  const textureResolution = readEnum(values, "textureResolution", ["2k", "4k", "8k"], "2k");
  if (model === "meshy-5" && textureResolution !== "2k") {
    throw new Error("Meshy 5 only supports 2K textures.");
  }
  const topology = readEnum(values, "topology", ["triangle", "quad"], "triangle");
  if (textureResolution === "8k" && topology === "quad") {
    throw new Error("Meshy does not support quad topology with 8K textures.");
  }
  const targetFaceCount = readNullableInteger(values, "targetFaceCount");
  if (model === "meshy-t1" && targetFaceCount !== null) {
    throw new Error("Meshy T1 does not support a target face count.");
  }
  const maximum = modelType === "smart-topology" ? 15_000 : 300_000;
  const minimum = 100;
  if (
    targetFaceCount !== null &&
    (targetFaceCount < minimum || targetFaceCount > maximum)
  ) {
    throw new Error(`Meshy target face count must be between ${minimum} and ${maximum}.`);
  }
  return {
    modelType,
    texture,
    pbr,
    textureResolution,
    topology,
    targetFaceCount,
    shouldRemesh: targetFaceCount !== null || readBoolean(values, "remesh", false),
    poseMode: readEnum(values, "poseMode", ["", "a-pose", "t-pose"], ""),
    imageEnhancement: readBoolean(values, "imageEnhancement", true),
    removeLighting: readBoolean(values, "removeLighting", true),
    ultraMode: readBoolean(values, "ultraMode", false)
  };
}
