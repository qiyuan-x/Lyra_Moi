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
  client?: ProviderHttpClient;
}

export class HunyuanAi3dClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #client: ProviderHttpClient;

  constructor(options: HunyuanAi3dClientOptions) {
    const url = new URL(requireText(options.baseUrl, "Hunyuan Base URL is required."));
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Hunyuan Base URL must use HTTP or HTTPS.");
    }
    this.#baseUrl = url.toString().replace(/\/+$/u, "");
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
    return this.#post("/v1/ai3d/submit", body, signal);
  }

  async query(
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    return this.#post("/v1/ai3d/query", body, signal);
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
        Authorization: this.#apiKey
      },
      body,
      signal
    ));
    const result = isRecord(response.Response) ? response.Response : response;
    if (isRecord(result.Error)) {
      const code = readOptionalText(result.Error.Code) ?? "UnknownError";
      const message = readOptionalText(result.Error.Message) ?? "Hunyuan request failed.";
      throw new ProviderConnectionError(mapHunyuanErrorCode(code), `${code}: ${message}`);
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
  readonly #api: HunyuanAi3dClient;
  readonly #downloadClient: ProviderHttpClient;

  constructor(options: HunyuanModelProviderOptions) {
    this.#model = requireText(options.model, "Hunyuan model is required.");
    this.#assetLoader = options.assetLoader;
    this.#settings = stripInternalProviderSettings(options.settings ?? {});
    this.#downloadClient = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
    this.#api = new HunyuanAi3dClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      client: this.#downloadClient
    });
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const parameters = parseHunyuanParameters(request, this.#model);
    const inputBody = isTextToModelGenerationRequest(request)
      ? { Prompt: requireModelPrompt(request) }
      : await this.#loadImageInput(request);
    const result = await this.#api.submit(
      {
        ...this.#settings,
        Model: this.#model,
        ...inputBody,
        GenerateType: parameters.generateType,
        EnablePBR: parameters.pbr,
        ...(parameters.targetFaceCount === null || parameters.generateType === "LowPoly"
          ? {}
          : { FaceCount: parameters.targetFaceCount }),
        ...(parameters.polygonType
          ? { PolygonType: parameters.polygonType }
          : {}),
        ...(parameters.resultFormat ? { ResultFormat: parameters.resultFormat } : {})
      },
      signal
    );
    return requireText(result.JobId, "Hunyuan did not return a task ID.");
  }

  async #loadImageInput(
    request: ModelGenerationRequest
  ): Promise<Record<string, unknown>> {
    const input = requireModelInput(request);
    const image = await this.#assetLoader.loadModelInput(input.assetId, input.projectId);
    return {
      ImageUrl: {
        Url: `data:${image.mimeType};base64,${image.data.toString("base64")}`
      }
    };
  }

  async query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult> {
    const result = await this.#api.query({ JobId: externalTaskId }, signal);
    const status = typeof result.Status === "string" ? result.Status.toUpperCase() : "";
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
    return {
      status: "succeeded",
      progress: 100,
      modelUrls,
      ...(previewUrl ? { previewUrl } : {}),
      ...(readOptionalNumber(result.ResultCreditConsumed) === undefined
        ? {}
        : { consumedCredits: readOptionalNumber(result.ResultCreditConsumed)! }),
      ...(readOptionalText(result.ResultCreditDetails)
        ? { providerState: { creditDetails: readOptionalText(result.ResultCreditDetails)! } }
        : {})
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

function parseHunyuanParameters(request: ModelGenerationRequest, model: string) {
  const values = request.parameters;
  const generateType = readEnum(
    values,
    "generateType",
    ["Normal", "LowPoly", "Geometry", "Sketch"],
    "Normal"
  );
  if (model === "3.1" && (generateType === "LowPoly" || generateType === "Sketch")) {
    throw new Error("Hunyuan 3.1 does not support LowPoly or Sketch mode.");
  }
  const texture = generateType !== "Geometry";
  const pbr = texture && readBoolean(values, "pbr", true);
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
    resultFormat: customFormats[0]?.toUpperCase() ?? null
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
  if (normalized.includes("limit")) return "RATE_LIMITED" as const;
  if (normalized.includes("notfound")) return "NOT_FOUND" as const;
  if (normalized.includes("internal")) return "SERVER_ERROR" as const;
  return "BAD_REQUEST" as const;
}
