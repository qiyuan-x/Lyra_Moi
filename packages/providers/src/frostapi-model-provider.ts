import type {
  ModelGenerationAdapterType,
  ModelGenerationRequest,
  ModelOutputFormat,
  ModelViewType
} from "@lyra/contracts";
import {
  isMultiViewToModelGenerationRequest,
  isTextToModelGenerationRequest,
  resolveModelGenerationAdapter
} from "@lyra/contracts";
import {
  createHunyuanGenerationParameters,
  parseHunyuanParameters
} from "./hunyuan-model-provider.js";
import {
  createMeshyGenerationParameters,
  parseMeshyParameters
} from "./meshy-model-provider.js";
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
  createTripoGenerationParameters,
  parseTripoParameters
} from "./tripo-model-provider.js";
import {
  providerFailure,
  readOptionalText,
  validateDownloadUrl
} from "./model-provider-utils.js";

export interface FrostApiModelProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  assetLoader: ModelProviderAssetLoader;
  client?: ProviderHttpClient;
}

export class FrostApiModelProvider implements BinaryModelProvider {
  readonly #baseUrl: string;
  readonly #apiUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ModelProviderAssetLoader;
  readonly #client: ProviderHttpClient;

  constructor(options: FrostApiModelProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "FrostAPI Base URL is required.")
      .replace(/\/+$/u, "");
    this.#apiUrl = `${this.#baseUrl.replace(/\/v1$/u, "")}/v1/3d`;
    this.#apiKey = requireText(options.apiKey, "FrostAPI API key is required.");
    this.#model = requireText(options.model, "FrostAPI model is required.");
    this.#assetLoader = options.assetLoader;
    this.#client = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const adapter = resolveModelGenerationAdapter("frostapi-3d", this.#model);
    if (!adapter) throw new Error(`FrostAPI model is not supported: ${this.#model}`);
    const providerRequest = await this.#createProviderRequest(adapter, request);
    const body = requireRecord(await this.#client.postJson(
      `${this.#apiUrl}/generations`,
      this.#headers(),
      { model: this.#model, ...providerRequest },
      signal
    ));
    return requireText(body.id, "FrostAPI did not return a task ID.");
  }

  async #createProviderRequest(
    adapter: ModelGenerationAdapterType,
    request: ModelGenerationRequest
  ): Promise<Record<string, unknown>> {
    if (adapter === "meshy") return this.#createMeshyRequest(request);
    if (adapter === "tripo") return this.#createTripoRequest(request);
    if (adapter === "hunyuan") return this.#createHunyuanRequest(request);
    if (isTextToModelGenerationRequest(request) || isMultiViewToModelGenerationRequest(request)) {
      throw new Error("Stability AI 3D requires a single image input.");
    }
    return {
      image_url: await this.#loadDataUrl(request.inputImageAssetId, request.projectId),
      output_format: "glb"
    };
  }

  async #createMeshyRequest(request: ModelGenerationRequest): Promise<Record<string, unknown>> {
    const parameters = parseMeshyParameters(request, this.#model);
    const textureImage = request.textureImageAssetId && parameters.textureGuideMode === "image"
      ? await this.#loadDataUrl(request.textureImageAssetId, request.projectId)
      : null;
    if (parameters.textureGuideMode === "image" && !textureImage) {
      throw new Error("Meshy texture input image is required for image texture guidance.");
    }
    const source = isTextToModelGenerationRequest(request)
      ? { prompt: requireModelPrompt(request) }
      : isMultiViewToModelGenerationRequest(request)
        ? { image_urls: await this.#loadViewDataUrls(request, MESHY_VIEWS) }
        : {
            image_url: await this.#loadDataUrl(
              requireModelInput(request).assetId,
              request.projectId
            )
          };
    return {
      ...source,
      ...(textureImage ? { texture_image_url: textureImage } : {}),
      ...(parameters.textureGuideMode === "text"
        ? { texture_prompt: parameters.texturePrompt }
        : {}),
      ...createMeshyGenerationParameters(request, this.#model, parameters)
    };
  }

  async #createTripoRequest(request: ModelGenerationRequest): Promise<Record<string, unknown>> {
    const parameters = parseTripoParameters(request, this.#model);
    const common = createTripoGenerationParameters(parameters);
    if (isTextToModelGenerationRequest(request)) {
      const prompt = requireModelPrompt(request);
      if (prompt.length > 1024) {
        throw new Error("Tripo text-to-model prompt cannot exceed 1024 characters.");
      }
      return {
        type: "text_to_model",
        model_version: this.#model,
        prompt,
        ...(parameters.negativePrompt ? { negative_prompt: parameters.negativePrompt } : {}),
        ...(parameters.imageSeed === null ? {} : { image_seed: parameters.imageSeed }),
        ...common
      };
    }
    if (isMultiViewToModelGenerationRequest(request)) {
      return {
        type: "multiview_to_model",
        model_version: this.#model,
        image_urls: await this.#loadViewDataUrls(request, TRIPO_VIEWS, true),
        ...common,
        texture_alignment: parameters.textureAlignment,
        orientation: parameters.orientation
      };
    }
    return {
      type: "image_to_model",
      model_version: this.#model,
      image_url: await this.#loadDataUrl(request.inputImageAssetId, request.projectId),
      ...common,
      enable_image_autofix: parameters.imageAutofix,
      texture_alignment: parameters.textureAlignment,
      orientation: parameters.orientation
    };
  }

  async #createHunyuanRequest(request: ModelGenerationRequest): Promise<Record<string, unknown>> {
    const parameters = parseHunyuanParameters(request, this.#model);
    let source: Record<string, unknown>;
    if (isTextToModelGenerationRequest(request)) {
      source = { prompt: requireModelPrompt(request) };
    } else if (isMultiViewToModelGenerationRequest(request)) {
      const entries = await this.#loadHunyuanViews(request);
      const front = entries.find(([view]) => view === "front")?.[1];
      if (!front) throw new Error("Hunyuan multi-view input requires a front image.");
      source = {
        image_base64: front,
        multi_view_images: entries.flatMap(([view, base64]) => view === "front"
          ? []
          : [{
              view: HUNYUAN_VIEW_TYPES[view as keyof typeof HUNYUAN_VIEW_TYPES],
              image: base64
            }])
      };
    } else {
      source = {
        image_base64: await this.#loadBase64(request.inputImageAssetId, request.projectId)
      };
    }
    return {
      ...source,
      ...createHunyuanGenerationParameters(parameters)
    };
  }

  async #loadViewDataUrls(
    request: Extract<ModelGenerationRequest, { inputMode: "multiview" }>,
    views: readonly ModelViewType[],
    preserveEmpty = false
  ): Promise<string[]> {
    const values: string[] = [];
    for (const view of views) {
      const assetId = request.multiViewImageAssetIds[view];
      if (!assetId) {
        if (preserveEmpty) values.push("");
        continue;
      }
      values.push(await this.#loadDataUrl(assetId, request.projectId));
    }
    return values;
  }

  async #loadHunyuanViews(
    request: Extract<ModelGenerationRequest, { inputMode: "multiview" }>
  ): Promise<Array<[ModelViewType, string]>> {
    const entries: Array<[ModelViewType, string]> = [];
    for (const [view, assetId] of Object.entries(request.multiViewImageAssetIds)) {
      entries.push([
        view as ModelViewType,
        await this.#loadBase64(assetId, request.projectId)
      ]);
    }
    return entries;
  }

  async #loadDataUrl(assetId: string, projectId: string): Promise<string> {
    const image = await this.#assetLoader.loadModelInput(assetId, projectId);
    return `data:${image.mimeType};base64,${image.data.toString("base64")}`;
  }

  async #loadBase64(assetId: string, projectId: string): Promise<string> {
    const image = await this.#assetLoader.loadModelInput(assetId, projectId);
    return image.data.toString("base64");
  }

  async query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult> {
    const taskId = requireText(externalTaskId, "FrostAPI task ID is required.");
    const body = requireRecord(await this.#client.getJson(
      `${this.#apiUrl}/tasks/${encodeURIComponent(taskId)}`,
      this.#headers(),
      signal
    ));
    const status = readOptionalText(body.status)?.toLowerCase() ?? "";
    const progress = normalizeProgress(
      body.progress,
      status === "queued" || status === "pending" ? 0 : 10
    );
    if (status === "queued" || status === "pending") return { status: "pending", progress };
    if (status === "processing" || status === "running") return { status: "running", progress };
    if (["failed", "cancelled", "canceled"].includes(status)) {
      const error = isRecord(body.error) ? body.error : {};
      return providerFailure(
        readOptionalText(error.message) ?? `FrostAPI task ended with status ${status}.`
      );
    }
    if (status !== "completed" && status !== "succeeded") {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "FrostAPI returned an unknown task status."
      );
    }
    const result = requireRecord(body.result, "FrostAPI task result is missing.");
    const modelUrls = readModelUrls(result.files);
    if (Object.keys(modelUrls).length === 0) {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "FrostAPI task result does not contain model files."
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
        "FrostAPI did not return downloadable model files."
      );
    }
    const files: GeneratedModelBinary[] = [];
    for (const format of request.outputFormats) {
      const source = result.modelUrls[format];
      if (!source) {
        throw new ProviderConnectionError(
          "INVALID_RESPONSE",
          `FrostAPI did not return the requested ${format.toUpperCase()} model.`
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

const MESHY_VIEWS: readonly ModelViewType[] = ["front", "left", "back", "right"];
const TRIPO_VIEWS: readonly ModelViewType[] = ["front", "left", "back", "right"];
const HUNYUAN_VIEW_TYPES = {
  left: "left",
  back: "back",
  right: "right",
  top: "top",
  bottom: "bottom",
  leftFront: "left_front",
  rightFront: "right_front"
} as const;

function readModelUrls(value: unknown): Partial<Record<ModelOutputFormat, string>> {
  if (!Array.isArray(value)) return {};
  const urls: Partial<Record<ModelOutputFormat, string>> = {};
  for (const item of value) {
    if (!isRecord(item)) continue;
    const format = readModelOutputFormat(item.format);
    const url = readOptionalText(item.url);
    if (format && url) urls[format] = url;
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
