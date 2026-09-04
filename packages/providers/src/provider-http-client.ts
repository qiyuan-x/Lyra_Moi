import { Agent, type Dispatcher } from "undici";
import { ProviderConnectionError, type ProviderConnectionErrorCode } from "./provider-errors.js";
import type { FetchLike } from "./provider-types.js";

export interface ProviderHttpClientOptions {
  fetchImplementation?: FetchLike;
  timeoutMs?: number | null;
  maxResponseBytes?: number;
  disableUndiciTimeouts?: boolean;
}

export class ProviderHttpClient {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number | null;
  readonly #maxResponseBytes: number;
  readonly #dispatcher: Dispatcher | null;

  constructor(options: ProviderHttpClientOptions = {}) {
    this.#fetch = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs === null
      ? null
      : positiveInteger(options.timeoutMs ?? 120_000, "Provider timeout");
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? 64 * 1024 * 1024,
      "Provider response limit"
    );
    this.#dispatcher = options.disableUndiciTimeouts
      ? new Agent({ headersTimeout: 0, bodyTimeout: 0 })
      : null;
  }

  getJson(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.requestJson(url, { method: "GET", headers }, signal);
  }

  postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.requestJson(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
      },
      signal
    );
  }

  postMultipart(
    url: string,
    headers: Record<string, string>,
    body: FormData,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.requestJson(url, { method: "POST", headers, body }, signal);
  }

  async postMultipartBinary(
    url: string,
    headers: Record<string, string>,
    body: FormData,
    signal?: AbortSignal
  ): Promise<{ data: Buffer; mimeType: string | null }> {
    const response = await this.#request(url, { method: "POST", headers, body }, signal);
    const data = await readLimitedBody(response, this.#maxResponseBytes);
    return {
      data,
      mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null
    };
  }

  async getBinary(
    url: string,
    headers: Record<string, string> = {},
    signal?: AbortSignal
  ): Promise<{ data: Buffer; mimeType: string | null }> {
    const response = await this.#request(url, { method: "GET", headers }, signal);
    const data = await readLimitedBody(response, this.#maxResponseBytes);
    return {
      data,
      mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null
    };
  }

  async requestJson(
    url: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.#request(url, init, signal);
    const data = await readLimitedBody(response, this.#maxResponseBytes);
    try {
      return JSON.parse(data.toString("utf8")) as unknown;
    } catch {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        "Provider returned invalid JSON.",
        response.status,
        readRequestId(response)
      );
    }
  }

  async #request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = this.#timeoutMs === null
      ? null
      : setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.#timeoutMs);
    timer?.unref();

    let response: Response;
    try {
      const requestInit: RequestInit & { dispatcher?: Dispatcher } = {
        ...init,
        signal: controller.signal
      };
      if (this.#dispatcher) requestInit.dispatcher = this.#dispatcher;
      response = await this.#fetch(url, requestInit);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
      if (timedOut) {
        throw new ProviderConnectionError("TIMEOUT", "Provider request timed out.");
      }
      const undiciCode = readNestedErrorCode(error);
      if (undiciCode === "UND_ERR_HEADERS_TIMEOUT") {
        throw new ProviderConnectionError(
          "TIMEOUT",
          "Provider response headers timed out."
        );
      }
      if (undiciCode === "UND_ERR_BODY_TIMEOUT") {
        throw new ProviderConnectionError(
          "TIMEOUT",
          "Provider response body timed out."
        );
      }
      throw new ProviderConnectionError("UNREACHABLE", "Provider could not be reached.");
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
      const requestId = readRequestId(response);
      const detail = await readProviderErrorMessage(response);
      throw new ProviderConnectionError(
        mapHttpErrorCode(response.status),
        detail
          ? `Provider returned HTTP ${response.status}: ${detail}`
          : `Provider returned HTTP ${response.status}.`,
        response.status,
        requestId
      );
    }
    return response;
  }
}

export function createImageProviderHttpClient(): ProviderHttpClient {
  return new ProviderHttpClient({
    timeoutMs: null,
    disableUndiciTimeouts: true
  });
}

async function readProviderErrorMessage(
  response: Response
): Promise<string | null> {
  try {
    const data = await readLimitedBody(response, 16 * 1024);
    const text = data.toString("utf8").trim();
    if (!text) return null;
    try {
      const value = JSON.parse(text) as unknown;
      const message = extractProviderErrorMessage(value);
      return message ? normalizeProviderErrorMessage(message) : null;
    } catch {
      return normalizeProviderErrorMessage(text);
    }
  } catch {
    return null;
  }
}

function extractProviderErrorMessage(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  if (typeof value.message === "string") return value.message;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") {
    return value.error.message;
  }
  return null;
}

function normalizeProviderErrorMessage(value: string): string | null {
  const normalized = value.replace(/\s+/gu, " ").trim().slice(0, 500);
  return normalized || null;
}

async function readLimitedBody(response: Response, limit: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw responseTooLarge(response);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw responseTooLarge(response);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function responseTooLarge(response: Response): ProviderConnectionError {
  return new ProviderConnectionError(
    "RESPONSE_TOO_LARGE",
    "Provider response exceeded the configured size limit.",
    response.status,
    readRequestId(response)
  );
}

function mapHttpErrorCode(status: number): ProviderConnectionErrorCode {
  if (status === 400 || status === 409 || status === 422) return "BAD_REQUEST";
  if (status === 401) return "AUTHENTICATION_FAILED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "HTTP_ERROR";
}

function readRequestId(response: Response): string | null {
  return response.headers.get("x-request-id") ?? response.headers.get("x-goog-request-id");
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNestedErrorCode(error: unknown): string | null {
  const visited = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}
