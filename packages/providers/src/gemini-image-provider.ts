import type { GenerationRequest } from "@lyra/contracts";
import type { BinaryImageProvider, GeneratedImageBinary } from "@lyra/core";
import { ProviderConnectionError } from "./provider-errors.js";
import {
  createImageProviderHttpClient,
  ProviderHttpClient
} from "./provider-http-client.js";
import type { ProviderAssetLoader } from "./image-provider-types.js";

export interface GeminiImageProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  assetLoader: ProviderAssetLoader;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class GeminiImageProvider implements BinaryImageProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ProviderAssetLoader;
  readonly #settings: Record<string, unknown>;
  readonly #client: ProviderHttpClient;

  constructor(options: GeminiImageProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Provider Base URL").replace(/\/+$/u, "");
    this.#apiKey = requireApiKey(options.apiKey);
    this.#model = requireText(options.model, "Provider model");
    this.#assetLoader = options.assetLoader;
    this.#settings = structuredClone(options.settings ?? {});
    this.#client = options.client ?? createImageProviderHttpClient();
  }

  async generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedImageBinary[]> {
    const input: Array<Record<string, unknown>> = [{ type: "text", text: request.prompt }];
    for (const attachment of request.attachments) {
      signal?.throwIfAborted();
      const image = await this.#assetLoader.loadImage(attachment.assetId, request.projectId);
      input.push({
        type: "image",
        mime_type: image.mimeType,
        data: Buffer.from(image.data).toString("base64")
      });
    }
    const output: GeneratedImageBinary[] = [];
    for (let index = 0; index < request.count; index += 1) {
      signal?.throwIfAborted();
      const body = await this.#client.postJson(
        `${this.#baseUrl}/interactions`,
        { "x-goog-api-key": this.#apiKey, Accept: "application/json" },
        createImageRequest(
          this.#model,
          { ...this.#settings, ...request.parameters },
          input
        ),
        signal
      );
      output.push(parseGeminiImage(body, index));
    }
    return output;
  }
}

function createImageRequest(
  model: string,
  parameters: Record<string, unknown>,
  input: readonly Record<string, unknown>[]
): Record<string, unknown> {
  const responseFormat: Record<string, unknown> = { type: "image" };
  copyString(parameters, responseFormat, "mimeType", "mime_type");
  copyString(parameters, responseFormat, "mime_type", "mime_type");
  copyString(parameters, responseFormat, "aspectRatio", "aspect_ratio");
  copyString(parameters, responseFormat, "aspect_ratio", "aspect_ratio");
  copyString(parameters, responseFormat, "imageSize", "image_size");
  copyString(parameters, responseFormat, "image_size", "image_size");
  copyImageResolution(parameters, responseFormat);
  const request: Record<string, unknown> = {
    model,
    input: structuredClone(input),
    response_format: responseFormat,
    store: false
  };
  const thinkingLevel = parameters.thinkingLevel ?? parameters.thinking_level;
  if (thinkingLevel !== undefined) {
    if (typeof thinkingLevel !== "string" || !["minimal", "low", "medium", "high"].includes(thinkingLevel)) {
      invalidSetting("thinkingLevel");
    }
    request.generation_config = { thinking_level: thinkingLevel };
  }
  return request;
}

function copyImageResolution(
  source: Record<string, unknown>,
  target: Record<string, unknown>
): void {
  const value = source.resolution;
  if (value === undefined || value === "auto") return;
  if (typeof value !== "string") invalidSetting("resolution");
  const normalized = value.trim().toUpperCase();
  if (normalized !== "1K" && normalized !== "2K" && normalized !== "4K") {
    invalidSetting("resolution");
  }
  target.image_size = normalized;
}

function parseGeminiImage(value: unknown, index: number): GeneratedImageBinary {
  if (!isRecord(value) || !Array.isArray(value.steps)) invalidResponse();
  for (const step of value.steps) {
    if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const content of step.content) {
      if (!isRecord(content) || content.type !== "image") continue;
      const encoded = readString(content.data);
      const mimeType = readString(content.mime_type) ?? "image/png";
      if (!encoded) invalidResponse();
      const data = decodeBase64(encoded);
      return {
        data,
        mimeType,
        name: `gemini-output-${index + 1}.${extensionFor(mimeType)}`
      };
    }
  }
  if (isRecord(value.output_image)) {
    const encoded = readString(value.output_image.data);
    const mimeType = readString(value.output_image.mime_type) ?? "image/png";
    if (encoded) {
      return {
        data: decodeBase64(encoded),
        mimeType,
        name: `gemini-output-${index + 1}.${extensionFor(mimeType)}`
      };
    }
  }
  invalidResponse();
}

function copyString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  sourceKey: string,
  targetKey: string
): void {
  const value = source[sourceKey];
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) invalidSetting(sourceKey);
  target[targetKey] = value;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) invalidResponse();
  const data = Buffer.from(normalized, "base64");
  if (!data.length) invalidResponse();
  return data;
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function requireApiKey(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
  }
  return normalized;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", `${label} is required.`);
  }
  return normalized;
}

function invalidSetting(label: string): never {
  throw new ProviderConnectionError("INVALID_CONFIGURATION", `Image parameter ${label} is invalid.`);
}

function invalidResponse(): never {
  throw new ProviderConnectionError("INVALID_RESPONSE", "Gemini image response is invalid.");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
