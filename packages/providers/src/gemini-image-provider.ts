import type { GenerationRequest } from "@lyra/contracts";
import { antigravityHeaders, antigravityProject, antigravityRequest, isAntigravityOAuth, unwrapAntigravity } from "./antigravity-client.js";
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
    if (this.#settings.antigravity === true) {
      const oauth = isAntigravityOAuth(this.#settings);
      const project = oauth ? await antigravityProject(this.#client, this.#baseUrl, this.#apiKey, signal, this.#settings.gcpProjectId) : "";
      const parts = input.map((part) => part.type === "text" ? { text: part.text } : { inlineData: { mimeType: part.mime_type, data: part.data } });
      const parameters = { ...this.#settings, ...request.parameters };
      const imageConfig: Record<string, unknown> = {};
      if (typeof parameters.aspectRatio === "string" && parameters.aspectRatio !== "auto") imageConfig.aspectRatio = parameters.aspectRatio;
      if (typeof parameters.resolution === "string" && parameters.resolution !== "auto") imageConfig.imageSize = parameters.resolution.toUpperCase();
      for (let index = 0; index < request.count; index += 1) {
        const payload = { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig } };
        const value = await this.#client.postJson(
          oauth ? `${this.#baseUrl}/v1internal:generateContent` : `${this.#baseUrl}/models/${encodeURIComponent(this.#model)}:generateContent`,
          oauth ? antigravityHeaders(this.#apiKey) : { "x-goog-api-key": this.#apiKey },
          oauth ? antigravityRequest(project, this.#model, payload) : payload, signal);
        const body = unwrapAntigravity(value);
        if (!isRecord(body) || !Array.isArray(body.candidates)) invalidResponse();
        const images = body.candidates.flatMap((candidate: unknown) => {
          if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return [];
          return candidate.content.parts.flatMap((part: unknown) => {
            if (!isRecord(part)) return [];
            const inline = part.inlineData ?? part.inline_data;
            if (!isRecord(inline) || typeof inline.data !== "string") return [];
            const mimeType = readString(inline.mimeType ?? inline.mime_type) ?? "image/png";
            if (!mimeType.startsWith("image/")) return [];
            return [{ data: decodeBase64(inline.data), mimeType, name: `antigravity-${index + 1}.${extensionFor(mimeType)}` }];
          });
        });
        if (!images.length) throw new Error("Antigravity 未返回图片，请检查所选模型是否支持生图。");
        output.push(...images);
      }
      return output;
    }
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
