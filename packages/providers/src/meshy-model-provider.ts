import type {
  ModelGenerationRequest,
  ModelOutputFormat,
  MultiViewToModelGenerationRequest
} from "@lyra/contracts";
import {
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
    if (isMultiViewToModelGenerationRequest(request)) {
      return this.#submitMultiView(request, parameters, signal);
    }
    const input = requireModelInput(request);
    const image = await this.#assetLoader.loadModelInput(input.assetId, input.projectId);
    if (request.textureImageAssetId && !parameters.texture) {
      throw new Error("Meshy texture generation must be enabled to use a texture reference image.");
    }
    if (parameters.textureGuideMode === "image" && !request.textureImageAssetId) {
      throw new Error("Meshy texture input image is required for image texture guidance.");
    }
    const textureImage = request.textureImageAssetId && parameters.textureGuideMode === "image"
      ? await this.#assetLoader.loadModelInput(request.textureImageAssetId, input.projectId)
      : null;
    const providerSettings = { ...this.#settings };
    delete providerSettings.texture_image_url;
    delete providerSettings.texture_prompt;
    const body = requireRecord(await this.#client.postJson(
      `${this.#baseUrl}/openapi/v1/image-to-3d`,
      this.#headers(),
      {
        ...providerSettings,
        image_url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
        ...(parameters.textureGuideMode === "image" && textureImage
          ? {
              texture_image_url:
                `data:${textureImage.mimeType};base64,${textureImage.data.toString("base64")}`
            }
          : {}),
        ...(parameters.textureGuideMode === "text"
          ? { texture_prompt: parameters.texturePrompt }
          : {}),
        model_type: parameters.modelType,
        ai_model: this.#model,
        should_texture: parameters.texture,
        enable_pbr: parameters.pbr,
        target_formats: request.outputFormats,
        texture_resolution: parameters.textureResolution,
        pose_mode: parameters.poseMode,
        moderation: parameters.moderation,
        auto_size: parameters.autoSize,
        alpha_thumbnail: parameters.alphaThumbnail,
        ...(parameters.autoSize ? { origin_at: parameters.originAt } : {}),
        ...(parameters.autoSize
          ? { multi_view_thumbnails: parameters.multiViewThumbnails }
          : {}),
        ...(parameters.modelType === "standard"
          ? {
              should_remesh: parameters.shouldRemesh,
              ...(parameters.shouldRemesh
                ? {
                    topology: parameters.topology,
                    save_pre_remeshed_model: parameters.savePreRemeshedModel,
                    ...(parameters.decimationMode === null
                      ? parameters.targetFaceCount === null
                        ? {}
                        : { target_polycount: parameters.targetFaceCount }
                      : { decimation_mode: parameters.decimationMode })
                  }
                : {})
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

  async #submitMultiView(
    request: MultiViewToModelGenerationRequest,
    parameters: ReturnType<typeof parseMeshyParameters>,
    signal?: AbortSignal
  ): Promise<string> {
    if (!["latest", "meshy-5", "meshy-6", "meshy-7"].includes(this.#model)) {
      throw new Error("The selected Meshy model does not support multi-image generation.");
    }
    const viewIds = (["front", "left", "back", "right"] as const)
      .flatMap((view) => {
        const assetId = request.multiViewImageAssetIds[view];
        return assetId ? [assetId] : [];
      });
    if (viewIds.length === 0 || viewIds.length > 4) {
      throw new Error("Meshy multi-image generation requires between 1 and 4 images.");
    }
    const images = await Promise.all(viewIds.map((assetId) =>
      this.#assetLoader.loadModelInput(assetId, request.projectId)
    ));
    if (request.textureImageAssetId && !parameters.texture) {
      throw new Error("Meshy texture generation must be enabled to use a texture reference image.");
    }
    if (parameters.textureGuideMode === "image" && !request.textureImageAssetId) {
      throw new Error("Meshy texture input image is required for image texture guidance.");
    }
    const textureImage = request.textureImageAssetId && parameters.textureGuideMode === "image"
      ? await this.#assetLoader.loadModelInput(request.textureImageAssetId, request.projectId)
      : null;
    const providerSettings = { ...this.#settings };
    for (const key of [
      "input_task_id",
      "image_url",
      "image_urls",
      "model_type",
      "texture_image_url",
      "texture_image_urls",
      "texture_prompt",
      "ultra_mode"
    ]) {
      delete providerSettings[key];
    }
    const body = requireRecord(await this.#client.postJson(
      `${this.#baseUrl}/openapi/v1/multi-image-to-3d`,
      this.#headers(),
      {
        ...providerSettings,
        image_urls: images.map((image) =>
          `data:${image.mimeType};base64,${image.data.toString("base64")}`
        ),
        ...(parameters.textureGuideMode === "image" && textureImage
          ? {
              texture_image_url:
                `data:${textureImage.mimeType};base64,${textureImage.data.toString("base64")}`
            }
          : {}),
        ...(parameters.textureGuideMode === "text"
          ? { texture_prompt: parameters.texturePrompt }
          : {}),
        ai_model: this.#model,
        should_texture: parameters.texture,
        enable_pbr: parameters.pbr,
        texture_resolution: parameters.textureResolution,
        should_remesh: parameters.shouldRemesh,
        ...(parameters.shouldRemesh
          ? {
              topology: parameters.topology,
              save_pre_remeshed_model: parameters.savePreRemeshedModel,
              ...(parameters.decimationMode === null
                ? parameters.targetFaceCount === null
                  ? {}
                  : { target_polycount: parameters.targetFaceCount }
                : { decimation_mode: parameters.decimationMode })
            }
          : {}),
        pose_mode: parameters.poseMode,
        ...(["latest", "meshy-6", "meshy-7"].includes(this.#model)
          ? {
              image_enhancement: parameters.imageEnhancement,
              remove_lighting: parameters.removeLighting
            }
          : {}),
        moderation: parameters.moderation,
        target_formats: request.outputFormats,
        auto_size: parameters.autoSize,
        alpha_thumbnail: parameters.alphaThumbnail,
        ...(parameters.autoSize
          ? {
              origin_at: parameters.originAt,
              multi_view_thumbnails: parameters.multiViewThumbnails
            }
          : {})
      },
      signal
    ));
    return encodeMultiViewCheckpoint(
      requireText(body.result, "Meshy did not return a multi-image task ID.")
    );
  }

  async query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult> {
    const textCheckpoint = decodeTextCheckpoint(externalTaskId);
    if (textCheckpoint) {
      return this.#queryTextTask(textCheckpoint, signal);
    }
    const multiViewTaskId = decodeMultiViewCheckpoint(externalTaskId);
    const body = requireRecord(await this.#client.getJson(
      multiViewTaskId
        ? `${this.#baseUrl}/openapi/v1/multi-image-to-3d/${encodeURIComponent(multiViewTaskId)}`
        : `${this.#baseUrl}/openapi/v1/image-to-3d/${encodeURIComponent(externalTaskId)}`,
      this.#headers(),
      signal
    ));
    return readMeshyTaskResult(body);
  }

  async #submitTextPreview(
    request: ModelGenerationRequest,
    parameters: ReturnType<typeof parseMeshyParameters>,
    signal?: AbortSignal
  ): Promise<string> {
    const prompt = requireModelPrompt(request);
    if (!["meshy-5", "meshy-6", "meshy-7", "latest", "meshy-t2"].includes(this.#model)) {
      throw new Error("The selected Meshy model does not support text-to-model generation.");
    }
    if (prompt.length > 600) {
      throw new Error("Meshy text-to-model prompt cannot exceed 600 characters.");
    }
    if (parameters.textureGuideMode === "image" && !request.textureImageAssetId) {
      throw new Error("Meshy texture input image is required for image texture guidance.");
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
        model_type: parameters.modelType,
        ai_model: this.#model,
        ...(["latest", "meshy-7"].includes(this.#model) && parameters.ultraMode
          ? { ultra_mode: true }
          : {}),
        target_formats: request.outputFormats,
        pose_mode: parameters.poseMode,
        moderation: parameters.moderation,
        auto_size: parameters.autoSize,
        alpha_thumbnail: parameters.alphaThumbnail,
        ...(parameters.autoSize ? { origin_at: parameters.originAt } : {}),
        ...(parameters.modelType === "standard"
          ? {
              should_remesh: parameters.shouldRemesh,
              ...(parameters.shouldRemesh
                ? {
                    topology: parameters.topology,
                    ...(parameters.decimationMode === null
                      ? parameters.targetFaceCount === null
                        ? {}
                        : { target_polycount: parameters.targetFaceCount }
                      : { decimation_mode: parameters.decimationMode })
                  }
                : {})
            }
          : parameters.targetFaceCount === null
            ? {}
            : { target_polycount: parameters.targetFaceCount })
      },
      signal
    ));
    return encodeTextCheckpoint({
      stage: "preview",
      taskId: requireText(body.result, "Meshy did not return a preview task ID."),
      refine: parameters.texture,
      projectId: request.projectId,
      ...(request.textureImageAssetId && parameters.textureGuideMode === "image"
        ? { textureImageAssetId: request.textureImageAssetId }
        : {}),
      outputFormats: request.outputFormats,
      pbr: parameters.pbr,
      textureResolution: parameters.textureResolution,
      removeLighting: parameters.removeLighting,
      textureGuideMode: parameters.textureGuideMode,
      texturePrompt: parameters.texturePrompt,
      moderation: parameters.moderation,
      autoSize: parameters.autoSize,
      originAt: parameters.originAt,
      alphaThumbnail: parameters.alphaThumbnail
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
      const textureImage = checkpoint.textureImageAssetId &&
        checkpoint.textureGuideMode === "image"
        ? await this.#assetLoader.loadModelInput(
            checkpoint.textureImageAssetId,
            checkpoint.projectId
          )
        : null;
      const providerSettings = { ...this.#settings };
      delete providerSettings.image_url;
      delete providerSettings.texture_image_url;
      delete providerSettings.texture_prompt;
      delete providerSettings.mode;
      delete providerSettings.preview_task_id;
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
          moderation: checkpoint.moderation,
          auto_size: checkpoint.autoSize,
          alpha_thumbnail: checkpoint.alphaThumbnail,
          ...(checkpoint.autoSize ? { origin_at: checkpoint.originAt } : {}),
          ...(this.#model === "meshy-6"
            ? { remove_lighting: checkpoint.removeLighting }
            : {}),
          target_formats: checkpoint.outputFormats,
          ...(checkpoint.textureGuideMode === "image" && textureImage
            ? {
                texture_image_url:
                  `data:${textureImage.mimeType};base64,${textureImage.data.toString("base64")}`
              }
            : {}),
          ...(checkpoint.textureGuideMode === "text"
            ? { texture_prompt: checkpoint.texturePrompt }
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
  textureGuideMode: "none" | "text" | "image";
  texturePrompt: string;
  moderation: boolean;
  autoSize: boolean;
  originAt: "bottom" | "center";
  alphaThumbnail: boolean;
}

const MESHY_MULTI_VIEW_PREFIX = "meshy-multiview:";

function encodeMultiViewCheckpoint(taskId: string): string {
  return `${MESHY_MULTI_VIEW_PREFIX}${Buffer.from(taskId, "utf8").toString("base64url")}`;
}

function decodeMultiViewCheckpoint(value: string): string | null {
  if (!value.startsWith(MESHY_MULTI_VIEW_PREFIX)) return null;
  try {
    const taskId = Buffer.from(
      value.slice(MESHY_MULTI_VIEW_PREFIX.length),
      "base64url"
    ).toString("utf8").trim();
    return taskId || null;
  } catch {
    return null;
  }
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
        removeLighting: parsed.removeLighting,
        textureGuideMode: parsed.textureGuideMode === "text" || parsed.textureGuideMode === "image"
          ? parsed.textureGuideMode
          : typeof parsed.textureImageAssetId === "string" ? "image" : "none",
        texturePrompt: typeof parsed.texturePrompt === "string" ? parsed.texturePrompt : "",
        moderation: typeof parsed.moderation === "boolean" ? parsed.moderation : false,
        autoSize: typeof parsed.autoSize === "boolean" ? parsed.autoSize : false,
        originAt: parsed.originAt === "center" ? "center" : "bottom",
        alphaThumbnail: typeof parsed.alphaThumbnail === "boolean"
          ? parsed.alphaThumbnail
          : false
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
  const pbr = readBoolean(values, "pbr", false);
  if (pbr && !texture) throw new Error("Meshy PBR requires texture generation.");
  const textureGuideMode = readEnum(
    values,
    "textureGuideMode",
    ["none", "text", "image"],
    request.textureImageAssetId ? "image" : "none"
  );
  const texturePrompt = readOptionalString(values, "texturePrompt");
  if (texturePrompt.length > 600) {
    throw new Error("Meshy texture prompt cannot exceed 600 characters.");
  }
  if (textureGuideMode === "text" && !texturePrompt.trim()) {
    throw new Error("Meshy texture prompt is required for text texture guidance.");
  }
  if (!texture && textureGuideMode !== "none") {
    throw new Error("Meshy texture guidance requires texture generation.");
  }
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
  const defaultRemesh = model === "meshy-5";
  const shouldRemesh = modelType === "standard" && readBoolean(values, "remesh", defaultRemesh);
  const decimationMode = readNullableInteger(values, "decimationMode");
  if (decimationMode !== null && ![1, 2, 3, 4].includes(decimationMode)) {
    throw new Error("Meshy decimation mode must be between 1 and 4.");
  }
  if (decimationMode !== null && !shouldRemesh) {
    throw new Error("Meshy adaptive decimation requires remesh.");
  }
  const savePreRemeshedModel = readBoolean(values, "savePreRemeshedModel", false);
  if (savePreRemeshedModel && !shouldRemesh) {
    throw new Error("Meshy pre-remeshed model output requires remesh.");
  }
  const autoSize = readBoolean(values, "autoSize", false);
  const multiViewThumbnails = readBoolean(values, "multiViewThumbnails", false);
  if (multiViewThumbnails && !autoSize) {
    throw new Error("Meshy multi-view thumbnails require auto size.");
  }
  return {
    modelType,
    texture,
    pbr,
    textureGuideMode,
    texturePrompt,
    textureResolution,
    topology,
    targetFaceCount,
    shouldRemesh,
    decimationMode,
    savePreRemeshedModel,
    poseMode: readEnum(values, "poseMode", ["", "a-pose", "t-pose"], ""),
    imageEnhancement: readBoolean(values, "imageEnhancement", true),
    removeLighting: readBoolean(values, "removeLighting", true),
    ultraMode: readBoolean(values, "ultraMode", false),
    moderation: readBoolean(values, "moderation", false),
    multiViewThumbnails,
    alphaThumbnail: readBoolean(values, "alphaThumbnail", false),
    autoSize,
    originAt: readEnum(values, "originAt", ["bottom", "center"], "bottom")
  };
}

export function createMeshyGenerationParameters(
  request: ModelGenerationRequest,
  model: string,
  parameters: ReturnType<typeof parseMeshyParameters>
): Record<string, unknown> {
  const textInput = isTextToModelGenerationRequest(request);
  if (textInput && request.prompt.trim().length > 600) {
    throw new Error("Meshy text-to-model prompt cannot exceed 600 characters.");
  }
  return {
    model_type: parameters.modelType,
    should_texture: parameters.texture,
    enable_pbr: parameters.pbr,
    target_formats: request.outputFormats,
    texture_resolution: parameters.textureResolution,
    pose_mode: parameters.poseMode,
    moderation: parameters.moderation,
    auto_size: parameters.autoSize,
    alpha_thumbnail: parameters.alphaThumbnail,
    ...(parameters.autoSize ? { origin_at: parameters.originAt } : {}),
    ...(!textInput && parameters.autoSize
      ? { multi_view_thumbnails: parameters.multiViewThumbnails }
      : {}),
    ...(parameters.modelType === "standard"
      ? {
          should_remesh: parameters.shouldRemesh,
          ...(parameters.shouldRemesh
            ? {
                topology: parameters.topology,
                ...(!textInput
                  ? { save_pre_remeshed_model: parameters.savePreRemeshedModel }
                  : {}),
                ...(parameters.decimationMode === null
                  ? parameters.targetFaceCount === null
                    ? {}
                    : { target_polycount: parameters.targetFaceCount }
                  : { decimation_mode: parameters.decimationMode })
              }
            : {})
        }
      : parameters.targetFaceCount === null
        ? {}
        : { target_polycount: parameters.targetFaceCount }),
    ...(!textInput && ["latest", "meshy-6", "meshy-7"].includes(model)
      ? { image_enhancement: parameters.imageEnhancement }
      : {}),
    ...(model === "meshy-6" ? { remove_lighting: parameters.removeLighting } : {}),
    ...(["latest", "meshy-7"].includes(model) && parameters.ultraMode
      ? { ultra_mode: true }
      : {})
  };
}

function readOptionalString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  return value;
}
