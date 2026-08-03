import type { GenerationRequest } from "@lyra/contracts";
import type { BinaryImageProvider, GeneratedImageBinary } from "@lyra/core";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import type { ProviderAssetLoader } from "./image-provider-types.js";

export interface OpenAiImageProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  assetLoader: ProviderAssetLoader;
  settings?: Record<string, unknown>;
  compatible?: boolean;
  client?: ProviderHttpClient;
}

export class OpenAiImageProvider implements BinaryImageProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string | null;
  readonly #model: string;
  readonly #assetLoader: ProviderAssetLoader;
  readonly #settings: Record<string, unknown>;
  readonly #compatible: boolean;
  readonly #client: ProviderHttpClient;

  constructor(options: OpenAiImageProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Provider Base URL").replace(/\/+$/u, "");
    this.#apiKey = normalizeApiKey(options.apiKey);
    if (!options.compatible && !this.#apiKey) {
      throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
    }
    this.#model = requireText(options.model, "Provider model");
    this.#assetLoader = options.assetLoader;
    this.#settings = structuredClone(options.settings ?? {});
    this.#compatible = options.compatible === true;
    this.#client = options.client ?? new ProviderHttpClient();
  }

  async generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedImageBinary[]> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;
    const parameters = normalizeImageParameters({ ...this.#settings, ...request.parameters });
    try {
      const body = request.attachments.length
        ? await this.#edit(request, parameters, headers, signal)
        : await this.#generate(request, parameters, headers, signal);
      return await parseOpenAiImages(
        body,
        request.count,
        parameters.output_format,
        this.#client,
        signal
      );
    } catch (error) {
      if (
        !this.#compatible ||
        !(error instanceof ProviderConnectionError) ||
        error.code !== "NOT_FOUND"
      ) {
        throw error;
      }
      return this.#generateWithChatCompletions(request, headers, signal);
    }
  }

  async #generateWithChatCompletions(
    request: GenerationRequest,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<GeneratedImageBinary[]> {
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: request.prompt }
    ];
    for (const attachment of request.attachments) {
      signal?.throwIfAborted();
      const image = await this.#assetLoader.loadImage(
        attachment.assetId,
        request.projectId
      );
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`
        }
      });
    }
    const output: GeneratedImageBinary[] = [];
    for (let index = 0; index < request.count; index += 1) {
      signal?.throwIfAborted();
      const body = await this.#client.postJson(
        `${this.#baseUrl}/chat/completions`,
        headers,
        {
          model: this.#model,
          messages: [{ role: "user", content }],
          modalities: ["text", "image"],
          stream: false
        },
        signal
      );
      output.push(
        await parseChatCompletionImage(body, index, this.#client, signal)
      );
    }
    return output;
  }

  #generate(
    request: GenerationRequest,
    parameters: Record<string, string | number>,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.#client.postJson(
      `${this.#baseUrl}/images/generations`,
      headers,
      {
        model: this.#model,
        prompt: request.prompt,
        n: request.count,
        ...parameters
      },
      signal
    );
  }

  async #edit(
    request: GenerationRequest,
    parameters: Record<string, string | number>,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const form = new FormData();
    form.append("model", this.#model);
    form.append("prompt", request.prompt);
    form.append("n", String(request.count));
    for (const [key, value] of Object.entries(parameters)) form.append(key, String(value));
    for (const attachment of request.attachments) {
      signal?.throwIfAborted();
      const image = await this.#assetLoader.loadImage(attachment.assetId, request.projectId);
      form.append(
        "image[]",
        new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
        image.name
      );
    }
    return this.#client.postMultipart(`${this.#baseUrl}/images/edits`, headers, form, signal);
  }
}

async function parseOpenAiImages(
  value: unknown,
  expectedCount: number,
  outputFormat: string | number | undefined,
  client: ProviderHttpClient,
  signal?: AbortSignal
): Promise<GeneratedImageBinary[]> {
  if (!isRecord(value)) invalidResponse();
  const rawItems = Array.isArray(value.data)
    ? value.data
    : Array.isArray(value.images)
      ? value.images
      : null;
  if (!rawItems) invalidResponse();
  const images: GeneratedImageBinary[] = [];
  for (const [index, rawItem] of rawItems.entries()) {
    signal?.throwIfAborted();
    const item = typeof rawItem === "string" ? { b64_json: rawItem } : rawItem;
    if (!isRecord(item)) invalidResponse();
    const encoded = readString(item.b64_json) ?? readString(item.base64) ?? readString(item.data);
    const url = readString(item.url);
    if (encoded) {
      const parsed = parseEncodedImage(encoded, String(outputFormat ?? "png"));
      images.push({ ...parsed, name: `openai-output-${index + 1}.${extensionFor(parsed.mimeType)}` });
    } else if (url) {
      const downloaded = await client.getBinary(url, {}, signal);
      const mimeType = downloaded.mimeType ?? mimeTypeForFormat(String(outputFormat ?? "png"));
      images.push({
        data: downloaded.data,
        mimeType,
        name: `openai-output-${index + 1}.${extensionFor(mimeType)}`
      });
    } else {
      invalidResponse();
    }
  }
  if (images.length !== expectedCount) {
    throw new ProviderConnectionError(
      "INVALID_RESPONSE",
      `Provider returned ${images.length} images, expected ${expectedCount}.`
    );
  }
  return images;
}

function normalizeImageParameters(value: Record<string, unknown>): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  copyString(value, result, "size", "size");
  if (result.size === undefined && value.aspectRatio !== undefined) {
    result.size = openAiSizeForAspectRatio(value.aspectRatio);
  }
  copyString(value, result, "quality", "quality");
  copyString(value, result, "background", "background");
  copyString(value, result, "moderation", "moderation");
  copyString(value, result, "outputFormat", "output_format");
  copyString(value, result, "output_format", "output_format");
  copyString(value, result, "inputFidelity", "input_fidelity");
  copyString(value, result, "input_fidelity", "input_fidelity");
  copyInteger(value, result, "outputCompression", "output_compression", 0, 100);
  copyInteger(value, result, "output_compression", "output_compression", 0, 100);
  return result;
}

function openAiSizeForAspectRatio(value: unknown): string {
  if (typeof value !== "string") invalidSetting("aspectRatio");
  switch (value.trim()) {
    case "1:1":
      return "1024x1024";
    case "16:9":
    case "4:3":
    case "3:2":
      return "1536x1024";
    case "9:16":
    case "3:4":
    case "2:3":
      return "1024x1536";
    default:
      return invalidSetting("aspectRatio");
  }
}

function copyString(
  source: Record<string, unknown>,
  target: Record<string, string | number>,
  sourceKey: string,
  targetKey: string
): void {
  const value = source[sourceKey];
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) invalidSetting(sourceKey);
  target[targetKey] = value;
}

function copyInteger(
  source: Record<string, unknown>,
  target: Record<string, string | number>,
  sourceKey: string,
  targetKey: string,
  minimum: number,
  maximum: number
): void {
  const value = source[sourceKey];
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalidSetting(sourceKey);
  }
  target[targetKey] = value as number;
}

function parseEncodedImage(
  value: string,
  defaultFormat: string
): { data: Buffer; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/su.exec(value);
  if (match) {
    return { data: decodeBase64(match[2]!), mimeType: match[1]! };
  }
  return { data: decodeBase64(value), mimeType: mimeTypeForFormat(defaultFormat) };
}

async function parseChatCompletionImage(
  value: unknown,
  index: number,
  client: ProviderHttpClient,
  signal?: AbortSignal
): Promise<GeneratedImageBinary> {
  if (!isRecord(value) || !Array.isArray(value.choices)) invalidResponse();
  for (const choice of value.choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) continue;
    const candidates = collectChatImageCandidates(choice.message);
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      const parsed = await readChatImageCandidate(candidate, client, signal);
      if (parsed) {
        return {
          ...parsed,
          name: `compatible-output-${index + 1}.${extensionFor(parsed.mimeType)}`
        };
      }
    }
  }
  invalidResponse();
}

function collectChatImageCandidates(
  message: Record<string, unknown>
): string[] {
  const candidates: string[] = [];
  if (Array.isArray(message.images)) {
    for (const image of message.images) {
      const candidate = readImageUrl(image);
      if (candidate) candidates.push(candidate);
    }
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const candidate = readImageUrl(part);
      if (candidate) candidates.push(candidate);
    }
  } else if (typeof message.content === "string") {
    const markdown = /!\[[^\]]*\]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/gu;
    for (const match of message.content.matchAll(markdown)) {
      if (match[1]) candidates.push(match[1]);
    }
    if (/^data:image\/[^;,]+;base64,/u.test(message.content.trim())) {
      candidates.push(message.content.trim());
    }
  }
  return candidates;
}

function readImageUrl(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const imageUrl = value.image_url;
  if (typeof imageUrl === "string") return imageUrl;
  if (isRecord(imageUrl)) {
    const url = readString(imageUrl.url);
    if (url) return url;
  }
  const inlineData = isRecord(value.inline_data)
    ? value.inline_data
    : isRecord(value.inlineData)
      ? value.inlineData
      : null;
  if (inlineData) {
    const data = readString(inlineData.data);
    const mimeType = readString(inlineData.mime_type)
      ?? readString(inlineData.mimeType)
      ?? "image/png";
    if (data) return `data:${mimeType};base64,${data}`;
  }
  return null;
}

async function readChatImageCandidate(
  candidate: string,
  client: ProviderHttpClient,
  signal?: AbortSignal
): Promise<{ data: Buffer; mimeType: string } | null> {
  if (candidate.startsWith("data:")) {
    return parseEncodedImage(candidate, "png");
  }
  if (/^https?:\/\//u.test(candidate)) {
    const downloaded = await client.getBinary(candidate, {}, signal);
    return {
      data: downloaded.data,
      mimeType: downloaded.mimeType ?? "image/png"
    };
  }
  return null;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) invalidResponse();
  const data = Buffer.from(normalized, "base64");
  if (!data.length) invalidResponse();
  return data;
}

function mimeTypeForFormat(value: string): string {
  switch (value.toLowerCase()) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function normalizeApiKey(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
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
  throw new ProviderConnectionError("INVALID_RESPONSE", "Provider image response is invalid.");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
