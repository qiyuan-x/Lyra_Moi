import type {
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import {
  isMeshyGenerationModel,
  isTextToModelGenerationRequest
} from "@lyra/contracts";
import { parseMeshyParameters } from "./meshy-model-provider.js";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import {
  normalizeProgress,
  requireModelInput,
  requireModelPrompt,
  requireRecord,
  requireText,
  type BinaryModelProvider,
  type GeneratedModelBinary,
  type ModelProviderAssetLoader,
  type ModelProviderResult
} from "./model-provider-types.js";
import {
  providerFailure,
  readOptionalText,
  validateDownloadUrl
} from "./model-provider-utils.js";

export interface OpenAiCompatibleModelProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  assetLoader: ModelProviderAssetLoader;
  client?: ProviderHttpClient;
}

export class OpenAiCompatibleModelProvider implements BinaryModelProvider {
  readonly #baseUrl: string;
  readonly #modelApiUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ModelProviderAssetLoader;
  readonly #client: ProviderHttpClient;

  constructor(options: OpenAiCompatibleModelProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "OpenAI-compatible 3D Base URL is required.")
      .replace(/\/+$/u, "");
    this.#modelApiUrl = `${this.#baseUrl.replace(/\/v1$/u, "")}/v1/3d`;
    this.#apiKey = requireText(options.apiKey, "OpenAI-compatible 3D API key is required.");
    this.#model = requireText(options.model, "OpenAI-compatible 3D model is required.");
    this.#assetLoader = options.assetLoader;
    this.#client = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const usesMeshySettings = isMeshyGenerationModel(
      "openai-compatible",
      this.#model
    );
    if (
      !usesMeshySettings &&
      (request.outputFormats.length !== 1 || request.outputFormats[0] !== "glb")
    ) {
      throw new Error("OpenAI-compatible 3D API 当前仅支持 GLB 输出。");
    }
    if (request.textureImageAssetId && !usesMeshySettings) {
      throw new Error("OpenAI-compatible 3D API 当前不支持独立纹理输入图。");
    }
    let source: { prompt: string } | { image_url: string };
    if (isTextToModelGenerationRequest(request)) {
      source = { prompt: requireModelPrompt(request) };
    } else {
      const input = requireModelInput(request);
      const image = await this.#assetLoader.loadModelInput(input.assetId, input.projectId);
      source = {
        image_url: `data:${image.mimeType};base64,${image.data.toString("base64")}`
      };
    }
    const meshyParameters = usesMeshySettings
      ? parseMeshyParameters(request, this.#model)
      : null;
    if (request.textureImageAssetId && meshyParameters && !meshyParameters.texture) {
      throw new Error("Meshy texture generation must be enabled to use a texture reference image.");
    }
    const textureImage = request.textureImageAssetId
      ? await this.#assetLoader.loadModelInput(request.textureImageAssetId, request.projectId)
      : null;
    const body = requireRecord(await this.#client.postJson(
      `${this.#modelApiUrl}/generations`,
      this.#headers(),
      {
        model: this.#model,
        ...source,
        ...(textureImage
          ? {
              texture_image_url:
                `data:${textureImage.mimeType};base64,${textureImage.data.toString("base64")}`
            }
          : {}),
        ...(meshyParameters
          ? createMeshyGenerationParameters(request, this.#model, meshyParameters)
          : {})
      },
      signal
    ));
    return requireText(body.id, "OpenAI-compatible 3D API did not return a task ID.");
  }

  async query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult> {
    const taskId = requireText(externalTaskId, "OpenAI-compatible 3D task ID is required.");
    const body = requireRecord(await this.#client.getJson(
      `${this.#modelApiUrl}/tasks/${encodeURIComponent(taskId)}`,
      this.#headers(),
      signal
    ));
    const status = readOptionalText(body.status)?.toLowerCase() ?? "";
    const progress = normalizeProgress(
      body.progress,
      status === "queued" || status === "pending" ? 0 : 10
    );
    if (status === "queued" || status === "pending") {
      return { status: "pending", progress };
    }
    if (status === "processing" || status === "running") {
      return { status: "running", progress };
    }
    if (["failed", "cancelled", "canceled"].includes(status)) {
      const error = isRecord(body.error) ? body.error : {};
      return providerFailure(
        readOptionalText(error.message) ?? `OpenAI-compatible 3D task ended with status ${status}.`
      );
    }
    if (status !== "completed" && status !== "succeeded") {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "OpenAI-compatible 3D API returned an unknown task status."
      );
    }

    const result = requireRecord(body.result, "OpenAI-compatible 3D task result is missing.");
    const modelUrls = readModelUrls(result.files);
    if (Object.keys(modelUrls).length === 0) {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "OpenAI-compatible 3D task result does not contain model files."
      );
    }
    const previewUrl = readOptionalText(result.preview_url);
    return {
      status: "succeeded",
      progress: 100,
      modelUrls,
      ...(previewUrl ? { previewUrl } : {})
    };
  }

  async download(
    result: ModelProviderResult,
    request: ModelGenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedModelBinary[]> {
    if (result.status !== "succeeded" || !result.modelUrls) {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "OpenAI-compatible 3D API did not return downloadable model files."
      );
    }
    const files: GeneratedModelBinary[] = [];
    for (const format of request.outputFormats) {
      const source = result.modelUrls[format];
      if (!source) {
        throw new ProviderConnectionError(
          "INVALID_RESPONSE",
          `OpenAI-compatible 3D API did not return the requested ${format.toUpperCase()} model.`
        );
      }
      const url = validateDownloadUrl(source);
      const headers = new URL(url).origin === new URL(this.#baseUrl).origin
        ? { Authorization: `Bearer ${this.#apiKey}` }
        : {};
      const response = await this.#client.getBinary(url, headers, signal);
      files.push({
        data: response.data,
        format,
        extension: format,
        mimeType: format === "glb" ? "model/gltf-binary" : "application/octet-stream",
        name: `model-${Date.now()}.${format}`
      });
    }
    return files;
  }

  #headers(): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.#apiKey}`
    };
  }
}

function createMeshyGenerationParameters(
  request: ModelGenerationRequest,
  model: string,
  parameters: ReturnType<typeof parseMeshyParameters>
): Record<string, unknown> {
  const textInput = isTextToModelGenerationRequest(request);
  if (textInput && request.prompt.trim().length > 600) {
    throw new Error("Meshy text-to-model prompt cannot exceed 600 characters.");
  }
  return {
    model_type: parameters.modelType === "smart-topology" && textInput
      ? "standard"
      : parameters.modelType,
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
    ...(!textInput && ["meshy-6", "meshy-7"].includes(model)
      ? { image_enhancement: parameters.imageEnhancement }
      : {}),
    ...(model === "meshy-6"
      ? { remove_lighting: parameters.removeLighting }
      : {}),
    ...(model === "meshy-7" && parameters.ultraMode
      ? { ultra_mode: true }
      : {})
  };
}

function readModelUrls(
  value: unknown
): Partial<Record<ModelOutputFormat, string>> {
  if (!Array.isArray(value)) return {};
  const urls: Partial<Record<ModelOutputFormat, string>> = {};
  for (const item of value) {
    if (!isRecord(item)) continue;
    const format = readModelOutputFormat(item.format);
    if (!format) continue;
    const url = readOptionalText(item.url);
    if (url) urls[format] = url;
  }
  return urls;
}

function readModelOutputFormat(value: unknown): ModelOutputFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ["glb", "obj", "fbx", "stl", "usdz", "3mf"].includes(normalized)
    ? normalized as ModelOutputFormat
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
