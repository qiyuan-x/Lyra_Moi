import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AssetListQuery,
  JobListQuery,
  PromptTemplateListQuery,
  ProviderServiceType
} from "@lyra/contracts";

export async function readJsonBody(
  request: IncomingMessage,
  configuredLimit = 2 * 1024 * 1024,
  allowEmpty = false
): Promise<unknown> {
  const limit = Number.isInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : 2 * 1024 * 1024;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > limit) throw new Error("JSON request body exceeds the configured limit.");
    chunks.push(data);
  }
  if (length === 0 && allowEmpty) return {};
  if (length === 0) throw new Error("JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8")) as unknown;
  } catch {
    throw new Error("JSON request body is invalid.");
  }
}

export async function readMultipartForm(
  request: IncomingMessage,
  configuredLimit = 26 * 1024 * 1024
): Promise<FormData> {
  const contentType = headerValue(request.headers["content-type"]);
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw new Error("multipart/form-data is required.");
  }
  const limit = Number.isInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : 26 * 1024 * 1024;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > limit) throw new Error("Asset upload exceeds the configured limit.");
    chunks.push(data);
  }
  const body = Buffer.concat(chunks, length);
  const webRequest = new Request("http://127.0.0.1/upload", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(body)
  });
  return webRequest.formData();
}

export function parseUploadTags(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) {
      throw new Error("Asset tags are invalid.");
    }
    return parsed;
  }
  return trimmed.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function parseJobQuery(url: URL): JobListQuery {
  const projectId = requireQueryValue(url, "projectId");
  const query: JobListQuery = { projectId };
  copyQuery(url, query, "conversationId");
  copyQuery(url, query, "agentRunId");
  copyQuery(url, query, "source");
  copyQuery(url, query, "status");
  copyQuery(url, query, "kind");
  if (url.searchParams.has("limit")) query.limit = parsePositiveInteger(url, "limit");
  return query;
}

export function parseAssetQuery(url: URL): AssetListQuery {
  const query: AssetListQuery = {};
  copyQuery(url, query, "cursor");
  copyQuery(url, query, "search");
  copyQuery(url, query, "tag");
  copyQuery(url, query, "source");
  copyQuery(url, query, "kind");
  if (url.searchParams.has("limit")) query.limit = parsePositiveInteger(url, "limit");
  return query;
}

export function parsePromptQuery(url: URL): PromptTemplateListQuery {
  const query: PromptTemplateListQuery = {};
  copyQuery(url, query, "search");
  copyQuery(url, query, "category");
  if (url.searchParams.has("favorite")) {
    const value = requireQueryValue(url, "favorite");
    if (value !== "true" && value !== "false") throw new Error("favorite must be true or false.");
    query.favorite = value === "true";
  }
  return query;
}

export function isProviderServiceType(value: string): value is ProviderServiceType {
  return value === "llm" || value === "image" || value === "model";
}

function copyQuery<T extends object>(url: URL, target: T, key: keyof T & string): void {
  const value = url.searchParams.get(key)?.trim();
  if (value) (target as Record<string, unknown>)[key] = value;
}

function parsePositiveInteger(url: URL, key: string): number {
  const value = requireQueryValue(url, key);
  if (!/^\d+$/u.test(value) || Number(value) < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return Number(value);
}

export function matchPath(pathname: string, expression: RegExp): string[] | null {
  const match = expression.exec(pathname);
  return match ? match.slice(1).map((value) => decodeURIComponent(value)) : null;
}

export function parseEventId(value: string): number {
  if (!/^\d+$/u.test(value)) throw new Error("Event cursor must be a non-negative integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Event cursor is too large.");
  return parsed;
}

export function requireQueryValue(url: URL, key: string): string {
  const value = url.searchParams.get(key)?.trim();
  if (!value) throw new Error(`${key} cannot be empty.`);
  return value;
}

export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

export function requireService<T>(value: T | undefined, name: string): T {
  if (!value) throw new ServiceUnavailableError(`${name} service is not configured.`);
  return value;
}

export function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  requestId: string
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Request-ID": requestId
  });
  response.end(body);
}

export function writeBinary(
  response: ServerResponse,
  data: Uint8Array,
  mimeType: string,
  etag: string,
  requestId: string
): void {
  response.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": data.byteLength,
    "Cache-Control": "private, max-age=3600",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId
  });
  response.end(data);
}

export function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || response.destroyed) {
      resolve();
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", finish);
      response.removeListener("drain", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    response.once("drain", finish);
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
