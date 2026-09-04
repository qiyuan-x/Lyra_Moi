import type {
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import {
  isHunyuan31ModelId,
  isMultiViewToModelGenerationRequest,
  isTextToModelGenerationRequest,
  normalizeHunyuan3dModelId
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
  readOptionalNumber,
  readOptionalText,
  stripInternalProviderSettings
} from "./model-provider-utils.js";

export interface HunyuanAi3dClientOptions {
  baseUrl: string;
  apiKey: string;
  variant?: HunyuanApiVariant;
  client?: ProviderHttpClient;
}

export type HunyuanApiVariant = "tokenhub" | "legacy";

export const HUNYUAN_TOKENHUB_BASE_URL = "https://tokenhub.tencentmaas.com";
export const HUNYUAN_LEGACY_BASE_URL = "https://api.ai3d.cloud.tencent.com";

export class HunyuanAi3dClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #variant: HunyuanApiVariant;
  readonly #client: ProviderHttpClient;

  constructor(options: HunyuanAi3dClientOptions) {
    const url = new URL(requireText(options.baseUrl, "Hunyuan Base URL is required."));
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Hunyuan Base URL must use HTTP or HTTPS.");
    }
    this.#variant = options.variant ?? "tokenhub";
    const normalized = url.toString().replace(/\/+$/u, "");
    this.#baseUrl = this.#variant === "tokenhub"
      ? normalized.replace(/\/v1$/u, "")
      : normalized;
    this.#apiKey = requireText(options.apiKey, "Hunyuan API key is required.");
    this.#client = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
  }

  async submit(
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    return this.#post(
      this.#variant === "tokenhub" ? "/v1/api/3d/submit" : "/v1/ai3d/submit",
      body,
      signal
    );
  }

  async query(
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    return this.#post(
      this.#variant === "tokenhub" ? "/v1/api/3d/query" : "/v1/ai3d/query",
      body,
      signal
    );
  }

  async #post(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const response = requireRecord(await this.#client.postJson(
      `${this.#baseUrl}${path}`,
      {
        Accept: "application/json",
        Authorization: this.#variant === "tokenhub"
          ? `Bearer ${this.#apiKey}`
          : this.#apiKey
      },
      body,
      signal
    ));
    const result = isRecord(response.Response) ? response.Response : response;
    const error = isRecord(result.error)
      ? result.error
      : isRecord(result.Error)
        ? result.Error
        : null;
    if (error) {
      const code = readOptionalText(error.code) ?? readOptionalText(error.Code) ?? "UnknownError";
      const message = readOptionalText(error.message) ??
        readOptionalText(error.message_zh) ??
        readOptionalText(error.Message) ??
        "Hunyuan request failed.";
      throw new ProviderConnectionError(mapHunyuanErrorCode(code), `${code}: ${message}`);
    }
    const flatCode = readOptionalText(result.ErrorCode);
    const status = readOptionalText(result.Status)?.toUpperCase();
    if (flatCode && status !== "FAIL") {
      const message = readOptionalText(result.ErrorMessage) ?? "Hunyuan request failed.";
      throw new ProviderConnectionError(
        mapHunyuanErrorCode(flatCode),
        `${flatCode}: ${message}`
      );
    }
    return result;
  }
}

export interface HunyuanModelProviderOptions extends HunyuanAi3dClientOptions {
  model: string;
  assetLoader: ModelProviderAssetLoader;
  settings?: Record<string, unknown>;
}

export class HunyuanModelProvider implements BinaryModelProvider {
  readonly #model: string;
  readonly #assetLoader: ModelProviderAssetLoader;
  readonly #settings: Record<string, unknown>;
  readonly #apis: Record<HunyuanApiVariant, HunyuanAi3dClient>;
  readonly #preferredVariant: HunyuanApiVariant;
  #activeVariant: HunyuanApiVariant | null = null;
  readonly #downloadClient: ProviderHttpClient;

  constructor(options: HunyuanModelProviderOptions) {
    const model = requireText(options.model, "Hunyuan model is required.");
    this.#model = normalizeHunyuan3dModelId(model) ?? failUnsupportedHunyuanModel(model);
    this.#assetLoader = options.assetLoader;
    this.#settings = stripInternalProviderSettings(options.settings ?? {});
    this.#downloadClient = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
    const endpoints = resolveHunyuanEndpoints(options.baseUrl);
    this.#preferredVariant = endpoints.preferredVariant;
    this.#apis = {
      tokenhub: new HunyuanAi3dClient({
        baseUrl: endpoints.tokenhubBaseUrl,
        apiKey: options.apiKey,
        variant: "tokenhub",
        client: this.#downloadClient
      }),
      legacy: new HunyuanAi3dClient({
        baseUrl: endpoints.legacyBaseUrl,
        apiKey: options.apiKey,
        variant: "legacy",
        client: this.#downloadClient
      })
    };
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const parameters = parseHunyuanParameters(request, this.#model);
    const source = await this.#loadSource(request);
    const variants = variantOrder(this.#activeVariant ?? this.#preferredVariant);
    let firstError: unknown;
    for (const variant of variants) {
      try {
        const result = await this.#apis[variant].submit(
          variant === "tokenhub"
            ? createTokenHubSubmitBody(this.#settings, this.#model, source, parameters)
            : createLegacySubmitBody(this.#settings, this.#model, source, parameters),
          signal
        );
        const taskId = variant === "tokenhub"
          ? requireText(result.id, "Hunyuan TokenHub did not return a task ID.")
          : requireText(result.JobId, "Hunyuan legacy API did not return a task ID.");
        this.#activeVariant = variant;
        return encodeHunyuanTaskId(variant, taskId);
      } catch (error) {
        firstError ??= error;
        if (!canTryAlternateHunyuanApi(error)) throw error;
      }
    }
    throw firstError;
  }

  async query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult> {
    const checkpoint = decodeHunyuanTaskId(externalTaskId);
    const variants = checkpoint.variant
      ? [checkpoint.variant]
      : variantOrder(this.#activeVariant ?? this.#preferredVariant);
    let firstError: unknown;
    for (const variant of variants) {
      try {
        const result = await this.#apis[variant].query(
          variant === "tokenhub"
            ? { model: this.#model, id: checkpoint.taskId }
            : { JobId: checkpoint.taskId },
          signal
        );
        this.#activeVariant = variant;
        return variant === "tokenhub"
          ? readTokenHubTaskResult(result)
          : readLegacyTaskResult(result);
      } catch (error) {
        firstError ??= error;
        if (checkpoint.variant || !canTryAlternateHunyuanApi(error)) throw error;
      }
    }
    throw firstError;
  }

  async #loadSource(request: ModelGenerationRequest): Promise<HunyuanGenerationSource> {
    if (isTextToModelGenerationRequest(request)) {
      return { type: "text", prompt: validateHunyuanPrompt(requireModelPrompt(request)) };
    }
    if (!isMultiViewToModelGenerationRequest(request)) {
      const input = requireModelInput(request);
      const image = await this.#assetLoader.loadModelInput(input.assetId, input.projectId);
      validateHunyuanImage(image.mimeType, image.data.byteLength, false);
      const base64 = image.data.toString("base64");
      return {
        type: "image",
        base64,
        dataUrl: `data:${image.mimeType};base64,${base64}`
      };
    }
    const entries = await Promise.all(Object.entries(request.multiViewImageAssetIds).map(
      async ([view, assetId]) => {
        const image = await this.#assetLoader.loadModelInput(assetId, request.projectId);
        validateHunyuanImage(image.mimeType, image.data.byteLength, true);
        const base64 = image.data.toString("base64");
        return {
          view: view as keyof typeof HUNYUAN_VIEW_TYPES | "front",
          dataLength: image.data.byteLength,
          base64,
          dataUrl: `data:${image.mimeType};base64,${base64}`
        };
      }
    ));
    const totalBytes = entries.reduce((total, entry) => total + entry.dataLength, 0);
    if (totalBytes > 6 * 1024 * 1024) {
      throw new Error("Hunyuan multi-view input images cannot exceed 6 MB in total.");
    }
    const front = entries.find((entry) => entry.view === "front");
    if (!front) throw new Error("Hunyuan multi-view input requires a front image.");
    return {
      type: "multiview",
      frontBase64: front.base64,
      frontDataUrl: front.dataUrl,
      views: entries.flatMap((entry) => entry.view === "front"
        ? []
        : [{
            view: HUNYUAN_VIEW_TYPES[entry.view],
            base64: entry.base64
        }])
    };
  }

  download(
    result: ModelProviderResult,
    request: ModelGenerationRequest,
    signal?: AbortSignal
  ) {
    return downloadGeneratedModels(
      this.#downloadClient,
      result,
      request,
      `hunyuan-${Date.now()}`,
      signal
    );
  }
}

type HunyuanGenerationSource =
  | { type: "text"; prompt: string }
  | { type: "image"; base64: string; dataUrl: string }
  | {
      type: "multiview";
      frontBase64: string;
      frontDataUrl: string;
      views: Array<{ view: string; base64: string }>;
    };

interface HunyuanEndpoints {
  preferredVariant: HunyuanApiVariant;
  tokenhubBaseUrl: string;
  legacyBaseUrl: string;
}

function createTokenHubSubmitBody(
  settings: Record<string, unknown>,
  model: string,
  source: HunyuanGenerationSource,
  parameters: ReturnType<typeof parseHunyuanParameters>
): Record<string, unknown> {
  const sourceFields = source.type === "text"
    ? { prompt: source.prompt }
    : source.type === "image"
      ? { image_base64: source.base64 }
      : {
          image_base64: source.frontBase64,
          multi_view_images: source.views.map((view) => ({
            view: view.view,
            image: view.base64
          }))
        };
  return {
    ...settings,
    model,
    ...sourceFields,
    ...createHunyuanGenerationParameters(parameters)
  };
}

function createLegacySubmitBody(
  settings: Record<string, unknown>,
  model: string,
  source: HunyuanGenerationSource,
  parameters: ReturnType<typeof parseHunyuanParameters>
): Record<string, unknown> {
  const sourceFields = source.type === "text"
    ? { Prompt: source.prompt }
    : source.type === "image"
      ? { ImageUrl: { Url: source.dataUrl } }
      : {
          ImageUrl: { Url: source.frontDataUrl },
          MultiViewImages: source.views.map((view) => ({
            ViewType: view.view,
            ViewImageBase64: view.base64
          }))
        };
  return {
    ...settings,
    Model: toLegacyHunyuanModel(model),
    ...sourceFields,
    GenerateType: parameters.generateType,
    EnablePBR: parameters.pbr,
    ...(parameters.targetFaceCount === null || parameters.generateType === "LowPoly"
      ? {}
      : { FaceCount: parameters.targetFaceCount }),
    ...(parameters.polygonType ? { PolygonType: parameters.polygonType } : {}),
    ...(parameters.resultFormat
      ? { ResultFormat: parameters.resultFormat.toUpperCase() }
      : {})
  };
}

function readTokenHubTaskResult(result: Record<string, unknown>): ModelProviderResult {
    const status = readOptionalText(result.status)?.toLowerCase() ?? "";
    if (status === "queued") return { status: "pending", progress: 5 };
    if (status === "in_progress") {
      return {
        status: "running",
        progress: normalizeProgress(result.progress, 50)
      };
    }
    if (status === "failed") {
      return providerFailure(
        readHunyuanTaskError(result) ??
          "Hunyuan model task failed."
      );
    }
    if (status !== "completed") {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "Hunyuan returned an unknown task status."
      );
    }
    const files = Array.isArray(result.data)
      ? result.data.flatMap((value) => isRecord(value) ? [value] : [])
      : [];
    const modelUrls: Partial<Record<ModelOutputFormat, string>> = {};
    let previewUrl: string | undefined;
    for (const file of files) {
      const type = readOptionalText(file.type)?.toLowerCase();
      const url = readOptionalText(file.url);
      if (type && url && isModelOutputFormat(type)) modelUrls[type] = url;
      previewUrl ??= readOptionalText(file.preview_image_url);
      if (type === "image") previewUrl ??= url;
    }
    return {
      status: "succeeded",
      progress: 100,
      modelUrls,
      ...(previewUrl ? { previewUrl } : {}),
      ...(readOptionalNumber(result.consumed_credits) === undefined
        ? {}
        : { consumedCredits: readOptionalNumber(result.consumed_credits)! }),
      ...(readOptionalText(result.request_id)
        ? { providerState: { requestId: readOptionalText(result.request_id)! } }
        : {})
    };
}

function readLegacyTaskResult(result: Record<string, unknown>): ModelProviderResult {
  const status = readOptionalText(result.Status)?.toUpperCase() ?? "";
  if (status === "WAIT") return { status: "pending", progress: 5 };
  if (status === "RUN") {
    return {
      status: "running",
      progress: normalizeProgress(result.Progress, 50)
    };
  }
  if (status === "FAIL") {
    return providerFailure(
      readOptionalText(result.ErrorMessage) ??
        readOptionalText(result.ErrorCode) ??
        "Hunyuan model task failed."
    );
  }
  if (status !== "DONE") {
    throw new ProviderConnectionError(
      "INVALID_RESPONSE",
      "Hunyuan returned an unknown task status."
    );
  }
  const files = Array.isArray(result.ResultFile3Ds)
    ? result.ResultFile3Ds.flatMap((value) => isRecord(value) ? [value] : [])
    : [];
  const modelUrls: Partial<Record<ModelOutputFormat, string>> = {};
  let previewUrl: string | undefined;
  for (const file of files) {
    const type = readOptionalText(file.Type)?.toLowerCase();
    const url = readOptionalText(file.Url);
    if (type && url && isModelOutputFormat(type)) modelUrls[type] = url;
    previewUrl ??= readOptionalText(file.PreviewImageUrl);
    if (type === "image") previewUrl ??= url;
  }
  const consumedCredits = readOptionalNumber(result.ResultCreditConsumed);
  const creditDetails = readOptionalText(result.ResultCreditDetails);
  return {
    status: "succeeded",
    progress: 100,
    modelUrls,
    ...(previewUrl ? { previewUrl } : {}),
    ...(consumedCredits === undefined ? {} : { consumedCredits }),
    ...(creditDetails ? { providerState: { creditDetails } } : {})
  };
}

export function parseHunyuanParameters(request: ModelGenerationRequest, model: string) {
  const values = request.parameters;
  const generateType = readEnum(
    values,
    "generateType",
    ["Normal", "LowPoly", "Geometry", "Sketch"],
    "Normal"
  );
  if (isHunyuan31ModelId(model) && (generateType === "LowPoly" || generateType === "Sketch")) {
    throw new Error("Hunyuan 3.1 does not support LowPoly or Sketch mode.");
  }
  if (isMultiViewToModelGenerationRequest(request) && generateType !== "Normal") {
    throw new Error("Hunyuan multi-view generation requires Normal mode.");
  }
  const texture = generateType !== "Geometry";
  const pbr = texture && readBoolean(values, "pbr", false);
  const targetFaceCount = readNullableInteger(values, "targetFaceCount");
  if (
    targetFaceCount !== null &&
    (targetFaceCount < 3_000 || targetFaceCount > 1_500_000)
  ) {
    throw new Error("Hunyuan target face count must be between 3000 and 1500000.");
  }
  const customFormats = request.outputFormats.filter((format) =>
    (["fbx", "stl", "usdz"] as ModelOutputFormat[]).includes(format)
  );
  return {
    generateType,
    pbr,
    targetFaceCount,
    polygonType: generateType === "LowPoly"
      ? readEnum(values, "polygonType", ["triangle", "quadrilateral"], "triangle")
      : null,
    resultFormat: customFormats[0] ?? null
  };
}

export function createHunyuanGenerationParameters(
  parameters: ReturnType<typeof parseHunyuanParameters>
): Record<string, unknown> {
  return {
    generate_type: HUNYUAN_GENERATE_TYPES[parameters.generateType],
    enable_pbr: parameters.pbr,
    ...(parameters.targetFaceCount === null || parameters.generateType === "LowPoly"
      ? {}
      : { face_count: parameters.targetFaceCount }),
    ...(parameters.polygonType ? { polygon_type: parameters.polygonType } : {}),
    ...(parameters.resultFormat ? { result_format: parameters.resultFormat } : {})
  };
}

function isModelOutputFormat(value: string): value is ModelOutputFormat {
  return ["glb", "obj", "fbx", "stl", "usdz", "3mf"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapHunyuanErrorCode(code: string) {
  const normalized = code.toLowerCase();
  if (normalized.includes("auth") || normalized.includes("credential")) {
    return "AUTHENTICATION_FAILED" as const;
  }
  if (normalized.includes("permission") || normalized.includes("unauthorized")) {
    return "PERMISSION_DENIED" as const;
  }
  if (normalized.includes("limit") || normalized.includes("quota")) {
    return "RATE_LIMITED" as const;
  }
  if (normalized.includes("notfound")) return "NOT_FOUND" as const;
  if (normalized.includes("internal")) return "SERVER_ERROR" as const;
  return "BAD_REQUEST" as const;
}

const HUNYUAN_VIEW_TYPES = {
  left: "left",
  back: "back",
  right: "right",
  top: "top",
  bottom: "bottom",
  leftFront: "left_front",
  rightFront: "right_front"
} as const;

const HUNYUAN_GENERATE_TYPES = {
  Normal: "normal",
  LowPoly: "low_poly",
  Geometry: "geometry",
  Sketch: "sketch"
} as const;

function validateHunyuanImage(
  mimeType: string,
  byteLength: number,
  multiView: boolean
): void {
  const allowed = multiView
    ? ["image/jpeg", "image/png"]
    : ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(mimeType)) {
    throw new Error(multiView
      ? "Hunyuan multi-view input images must use JPEG or PNG format."
      : "Hunyuan input images must use JPEG, PNG, or WebP format.");
  }
  if (byteLength > 6 * 1024 * 1024) {
    throw new Error("Hunyuan input image cannot exceed 6 MB.");
  }
}

function validateHunyuanPrompt(prompt: string): string {
  if ([...prompt].length > 1024) {
    throw new Error("Hunyuan text-to-model prompt cannot exceed 1024 characters.");
  }
  return prompt;
}

function readHunyuanTaskError(result: Record<string, unknown>): string | null {
  if (isRecord(result.error)) {
    return readOptionalText(result.error.message_zh) ??
      readOptionalText(result.error.message) ??
      readOptionalText(result.error.code) ??
      null;
  }
  return readOptionalText(result.message) ?? readOptionalText(result.error_message) ?? null;
}

function resolveHunyuanEndpoints(baseUrl: string): HunyuanEndpoints {
  const configured = normalizeHunyuanBaseUrl(baseUrl);
  const hostname = new URL(configured).hostname.toLowerCase();
  if (hostname === new URL(HUNYUAN_LEGACY_BASE_URL).hostname) {
    return {
      preferredVariant: "legacy",
      tokenhubBaseUrl: HUNYUAN_TOKENHUB_BASE_URL,
      legacyBaseUrl: configured
    };
  }
  return {
    preferredVariant: "tokenhub",
    tokenhubBaseUrl: configured,
    legacyBaseUrl: HUNYUAN_LEGACY_BASE_URL
  };
}

function normalizeHunyuanBaseUrl(value: string): string {
  const url = new URL(requireText(value, "Hunyuan Base URL is required."));
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Hunyuan Base URL must use HTTP or HTTPS.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === new URL(HUNYUAN_TOKENHUB_BASE_URL).hostname ||
    hostname === new URL(HUNYUAN_LEGACY_BASE_URL).hostname
  ) {
    return url.origin;
  }
  return url.toString().replace(/\/+$/u, "");
}

function variantOrder(preferred: HunyuanApiVariant): HunyuanApiVariant[] {
  return preferred === "tokenhub"
    ? ["tokenhub", "legacy"]
    : ["legacy", "tokenhub"];
}

function canTryAlternateHunyuanApi(error: unknown): boolean {
  return error instanceof ProviderConnectionError && [
    "AUTHENTICATION_FAILED",
    "PERMISSION_DENIED",
    "BAD_REQUEST",
    "NOT_FOUND"
  ].includes(error.code);
}

function encodeHunyuanTaskId(variant: HunyuanApiVariant, taskId: string): string {
  return `${variant}:${taskId}`;
}

function decodeHunyuanTaskId(value: string): {
  variant: HunyuanApiVariant | null;
  taskId: string;
} {
  const encoded = requireText(value, "Hunyuan task ID is required.");
  for (const variant of ["tokenhub", "legacy"] as const) {
    const prefix = `${variant}:`;
    if (encoded.startsWith(prefix)) {
      return {
        variant,
        taskId: requireText(encoded.slice(prefix.length), "Hunyuan task ID is required.")
      };
    }
  }
  return { variant: null, taskId: encoded };
}

function toLegacyHunyuanModel(model: string): "3.0" | "3.1" {
  return isHunyuan31ModelId(model) ? "3.1" : "3.0";
}

function failUnsupportedHunyuanModel(model: string): never {
  throw new Error(`Hunyuan model is not supported: ${model}`);
}
