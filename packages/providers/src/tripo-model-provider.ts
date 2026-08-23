import type { ModelGenerationRequest, ModelOutputFormat } from "@lyra/contracts";
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
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ModelProviderAssetLoader;
  readonly #settings: Record<string, unknown>;
  readonly #client: ProviderHttpClient;

  constructor(options: TripoModelProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Tripo Base URL is required.").replace(/\/+$/u, "");
    this.#apiKey = requireText(options.apiKey, "Tripo API key is required.");
    this.#model = requireText(options.model, "Tripo model is required.");
    this.#assetLoader = options.assetLoader;
    this.#settings = stripInternalProviderSettings(options.settings ?? {});
    this.#client = options.client ?? new ProviderHttpClient({
      timeoutMs: 120_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const outputFormats = normalizeOutputFormats(request.outputFormats);
    const parameters = parseTripoParameters(request, this.#model);
    if (isTextToModelGenerationRequest(request)) {
      const prompt = requireModelPrompt(request);
      if (prompt.length > 1024) {
        throw new Error("Tripo text-to-model prompt cannot exceed 1024 characters.");
      }
      const task = this.#unwrap(await this.#client.postJson(
        `${this.#baseUrl}/task`,
        this.#headers(),
        {
          ...this.#settings,
          type: "text_to_model",
          model_version: this.#model,
          prompt,
          texture: parameters.texture,
          pbr: parameters.pbr,
          face_limit: parameters.faceLimit,
          texture_quality: parameters.textureQuality,
          ...(parameters.geometryQuality
            ? { geometry_quality: parameters.geometryQuality }
            : {})
        },
        signal
      ));
      return encodeCheckpoint({
        stage: "generation",
        taskId: requireText(task.task_id, "Tripo did not return a task ID."),
        outputFormats
      });
    }
    const input = requireModelInput(request);
    const image = await this.#assetLoader.loadModelInput(input.assetId, input.projectId);
    const upload = new FormData();
    upload.append(
      "file",
      new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
      image.name
    );
    const uploadBody = this.#unwrap(await this.#client.postMultipart(
      `${this.#baseUrl}/upload/sts`,
      this.#headers(),
      upload,
      signal
    ));
    const fileToken = requireText(
      uploadBody.image_token ?? uploadBody.file_token,
      "Tripo did not return an image token."
    );
    const task = this.#unwrap(await this.#client.postJson(
      `${this.#baseUrl}/task`,
      this.#headers(),
      {
        ...this.#settings,
        type: "image_to_model",
        model_version: this.#model,
        file: { type: "jpg", file_token: fileToken },
        texture: parameters.texture,
        pbr: parameters.pbr,
        face_limit: parameters.faceLimit,
        texture_quality: parameters.textureQuality,
        enable_image_autofix: parameters.imageAutofix,
        orientation: parameters.orientation,
        ...(parameters.geometryQuality
          ? { geometry_quality: parameters.geometryQuality }
          : {})
      },
      signal
    ));
    return encodeCheckpoint({
      stage: "generation",
      taskId: requireText(task.task_id, "Tripo did not return a task ID."),
      outputFormats
    });
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
          readOptionalText(body.message) ?? `Tripo task ended with status ${status}.`
        );
      }
      throw new ProviderConnectionError("INVALID_RESPONSE", "Tripo returned an unknown task status.");
    }
    const output = requireRecord(body.output, "Tripo model output is missing.");
    const modelUrls = {
      glb: requireText(
        output.pbr_model ?? output.model ?? output.base_model,
        "Tripo did not return a model URL."
      )
    };
    const previewUrl = readOptionalText(output.rendered_image);
    const conversionFormats = checkpoint.outputFormats.filter((format) => format !== "glb");
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
        `${this.#baseUrl}/task`,
        this.#headers(),
        {
          type: "convert_model",
          format: format.toUpperCase(),
          original_model_task_id: checkpoint.taskId
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
            readOptionalText(body.message) ?? `Tripo conversion ended with status ${status}.`
          );
        }
        throw new ProviderConnectionError(
          "INVALID_RESPONSE",
          "Tripo returned an unknown conversion task status."
        );
      }
      const output = requireRecord(body.output, "Tripo conversion output is missing.");
      modelUrls[format] = requireText(
        output.model ?? output.base_model ?? output.pbr_model,
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
      `${this.#baseUrl}/task/${encodeURIComponent(taskId)}`,
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
        response.code === 1004 ? "AUTHENTICATION_FAILED" : "BAD_REQUEST",
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
    return { stage: "generation", taskId: value, outputFormats: ["glb"] };
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
        outputFormats: parsed.outputFormats.filter(isModelOutputFormat)
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
  return { stage: "generation", taskId: value, outputFormats: ["glb"] };
}

function isModelOutputFormat(value: unknown): value is ModelOutputFormat {
  return typeof value === "string" &&
    ["glb", "obj", "fbx", "stl", "usdz", "3mf"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTripoParameters(request: ModelGenerationRequest, model: string) {
  const values = request.parameters;
  const p1 = model.startsWith("P1-");
  const supportsGeometryQuality = model.startsWith("v3.");
  const texture = readBoolean(values, "texture", true);
  const pbr = readBoolean(values, "pbr", true);
  if (pbr && !texture) throw new Error("Tripo PBR requires texture generation.");
  const geometryQuality = supportsGeometryQuality
    ? readEnum(values, "geometryQuality", ["standard", "detailed"], "standard")
    : null;
  const faceLimit = readNullableInteger(values, "targetFaceCount") ?? (p1 ? 20_000 : 500_000);
  const maximum = p1
    ? 20_000
    : !supportsGeometryQuality
      ? 500_000
      : geometryQuality === "detailed"
        ? 2_000_000
        : 1_500_000;
  const minimum = p1 ? 48 : 1_000;
  if (faceLimit < minimum || faceLimit > maximum) {
    throw new Error(`Tripo target face count must be between ${minimum} and ${maximum}.`);
  }
  return {
    texture,
    pbr,
    faceLimit,
    geometryQuality,
    textureQuality: readEnum(
      values,
      "textureQuality",
      ["standard", "detailed", "extreme"],
      "standard"
    ),
    imageAutofix: readBoolean(values, "imageAutofix", false),
    orientation: readEnum(
      values,
      "orientation",
      ["default", "align_image"],
      "default"
    )
  };
}
