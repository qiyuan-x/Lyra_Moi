import type { GenerationRequest } from "@lyra/contracts";
import type { BinaryImageProvider, GeneratedImageBinary } from "@lyra/core";
import { ProviderConnectionError } from "./provider-errors.js";
import {
  createImageProviderHttpClient,
  ProviderHttpClient
} from "./provider-http-client.js";
import type { ProviderAssetLoader } from "./image-provider-types.js";

export interface DashScopeImageProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  assetLoader: ProviderAssetLoader;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class DashScopeImageProvider implements BinaryImageProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ProviderAssetLoader;
  readonly #settings: Record<string, unknown>;
  readonly #client: ProviderHttpClient;

  constructor(options: DashScopeImageProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "DashScope Base URL").replace(/\/+$/u, "");
    this.#apiKey = requireText(options.apiKey, "DashScope API key");
    this.#model = requireText(options.model, "DashScope model");
    this.#assetLoader = options.assetLoader;
    this.#settings = structuredClone(options.settings ?? {});
    this.#client = options.client ?? createImageProviderHttpClient();
  }

  async generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedImageBinary[]> {
    const references = await Promise.all(request.attachments.map(async (attachment) => {
      const image = await this.#assetLoader.loadImage(attachment.assetId, request.projectId);
      return `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`;
    }));
    const output: GeneratedImageBinary[] = [];
    for (let index = 0; index < request.count; index += 1) {
      signal?.throwIfAborted();
      const body = this.#model.startsWith("wan")
        ? await this.#generateWan(request, references, signal)
        : await this.#generateQwen(request, references, signal);
      const url = readImageUrl(body);
      if (!url) invalidResponse();
      const downloaded = await this.#client.getBinary(url, {}, signal);
      const mimeType = downloaded.mimeType ?? "image/png";
      output.push({
        data: downloaded.data,
        mimeType,
        name: `dashscope-output-${index + 1}.${extensionFor(mimeType)}`
      });
    }
    return output;
  }

  #generateQwen(
    request: GenerationRequest,
    references: readonly string[],
    signal?: AbortSignal
  ): Promise<unknown> {
    const content: Array<Record<string, unknown>> = references.map((image) => ({ image }));
    content.push({ text: request.prompt });
    return this.#client.postJson(
      `${this.#baseUrl}/services/aigc/multimodal-generation/generation`,
      this.#headers(),
      {
        model: this.#model,
        messages: [{ role: "user", content }],
        prompt_extend: readBoolean(this.#settings.promptExtend, true),
        ...imageParameters(request.parameters)
      },
      signal
    );
  }

  #generateWan(
    request: GenerationRequest,
    references: readonly string[],
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.#client.postJson(
      `${this.#baseUrl}/services/aigc/image-generation/generation`,
      this.#headers(),
      {
        model: this.#model,
        input: {
          prompt: request.prompt,
          ...(references.length ? { images: references } : {})
        },
        parameters: imageParameters(request.parameters)
      },
      signal
    );
  }

  #headers(): Record<string, string> {
    return { Accept: "application/json", Authorization: `Bearer ${this.#apiKey}` };
  }
}

function imageParameters(source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const size = source.size ?? source.aspectRatio;
  if (typeof size === "string" && size.trim()) result.size = normalizeSize(size);
  return result;
}

function normalizeSize(value: string): string {
  switch (value.trim()) {
    case "1:1": return "1024*1024";
    case "16:9": return "1664*928";
    case "9:16": return "928*1664";
    case "4:3": return "1472*1104";
    case "3:4": return "1104*1472";
    case "3:2": return "1584*1056";
    case "2:3": return "1056*1584";
    default: return value.replace("x", "*");
  }
}

function readImageUrl(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.output)) {
    const output = value.output;
    if (Array.isArray(output.choices)) {
      for (const choice of output.choices) {
        if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.content)) continue;
        for (const part of choice.message.content) {
          if (isRecord(part) && typeof part.image === "string" && part.image) return part.image;
        }
      }
    }
    if (Array.isArray(output.results)) {
      for (const result of output.results) {
        if (isRecord(result) && typeof result.url === "string" && result.url) return result.url;
      }
    }
  }
  return null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", "DashScope promptExtend is invalid.");
  }
  return value;
}

function requireText(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", `${label} is required.`);
  }
  return normalized;
}

function extensionFor(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

function invalidResponse(): never {
  throw new ProviderConnectionError("INVALID_RESPONSE", "DashScope image response is invalid.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
