import type { GenerationRequest } from "@lyra/contracts";
import type { BinaryImageProvider, GeneratedImageBinary } from "@lyra/core";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import type { ProviderAssetLoader } from "./image-provider-types.js";

export interface StabilityImageProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  assetLoader: ProviderAssetLoader;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class StabilityImageProvider implements BinaryImageProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ProviderAssetLoader;
  readonly #client: ProviderHttpClient;

  constructor(options: StabilityImageProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Stability Base URL").replace(/\/+$/u, "");
    this.#apiKey = requireText(options.apiKey, "Stability API key");
    this.#model = requireText(options.model, "Stability model");
    this.#assetLoader = options.assetLoader;
    this.#client = options.client ?? new ProviderHttpClient({ timeoutMs: 10 * 60_000 });
  }

  async generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedImageBinary[]> {
    const reference = request.attachments[0]
      ? await this.#assetLoader.loadImage(request.attachments[0].assetId, request.projectId)
      : null;
    const output: GeneratedImageBinary[] = [];
    for (let index = 0; index < request.count; index += 1) {
      signal?.throwIfAborted();
      const form = new FormData();
      form.append("prompt", request.prompt);
      form.append("output_format", normalizeFormat(request.parameters.outputFormat));
      if (reference) {
        form.append(
          "image",
          new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }),
          reference.name
        );
        form.append("strength", String(readNumber(request.parameters.strength, 0.65)));
      }
      const aspectRatio = request.parameters.aspectRatio;
      if (!reference && typeof aspectRatio === "string" && aspectRatio.trim()) {
        form.append("aspect_ratio", aspectRatio.trim());
      }
      if (this.#model.startsWith("sd3")) form.append("model", this.#model);
      const binary = await this.#client.postMultipartBinary(
        `${this.#baseUrl}${endpointFor(this.#model)}`,
        { Authorization: `Bearer ${this.#apiKey}`, Accept: "image/*" },
        form,
        signal
      );
      const mimeType = binary.mimeType ?? mimeTypeForFormat(normalizeFormat(request.parameters.outputFormat));
      output.push({
        data: binary.data,
        mimeType,
        name: `stability-output-${index + 1}.${extensionFor(mimeType)}`
      });
    }
    return output;
  }
}

function endpointFor(model: string): string {
  if (model === "stable-image-ultra") return "/v2beta/stable-image/generate/ultra";
  if (model === "stable-image-core") return "/v2beta/stable-image/generate/core";
  if (model.startsWith("sd3")) return "/v2beta/stable-image/generate/sd3";
  throw new ProviderConnectionError("INVALID_CONFIGURATION", `Unsupported Stability image model: ${model}.`);
}

function normalizeFormat(value: unknown): "png" | "jpeg" | "webp" {
  if (value === undefined) return "png";
  if (typeof value !== "string") invalidSetting("outputFormat");
  const normalized = value.toLowerCase() === "jpg" ? "jpeg" : value.toLowerCase();
  if (normalized !== "png" && normalized !== "jpeg" && normalized !== "webp") {
    invalidSetting("outputFormat");
  }
  return normalized;
}

function readNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    invalidSetting("strength");
  }
  return value;
}

function mimeTypeForFormat(format: string): string {
  return format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
}

function extensionFor(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

function requireText(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", `${label} is required.`);
  }
  return normalized;
}

function invalidSetting(label: string): never {
  throw new ProviderConnectionError("INVALID_CONFIGURATION", `Stability parameter ${label} is invalid.`);
}
