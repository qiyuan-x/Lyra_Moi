import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
  encodeServerSentEvent,
  encodeServerSentEventHeartbeat
} from "@lyra/core";
import {
  headerValue,
  parseEventId,
  requireQueryValue,
  ServiceUnavailableError,
  waitForDrain,
  writeJson
} from "./http-helpers.js";
import { handleBusinessRoute } from "./business-routes.js";
import type { CreateApiServerOptions } from "./api-types.js";

export type { CreateApiServerOptions } from "./api-types.js";

export function createApiServer(options: CreateApiServerOptions): Server {
  const activeFeeds = new Set<AbortController>();
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, activeFeeds);
  });
  server.on("close", () => {
    for (const controller of activeFeeds) controller.abort();
    activeFeeds.clear();
  });
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CreateApiServerOptions,
  activeFeeds: Set<AbortController>
): Promise<void> {
  const requestId = `req_${randomUUID()}`;
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/v1/health/live") {
      writeJson(response, 200, { ok: true }, requestId);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/v1/health/ready") {
      const status = options.readiness?.() ?? { ok: options.isReady?.() ?? true };
      writeJson(response, status.ok ? 200 : 503, status, requestId);
      return;
    }
    if (url.pathname.startsWith("/api/") && !isAuthorized(request, url, options.accessToken)) {
      writeApiError(response, 401, "UNAUTHORIZED", "Access token is invalid or missing.", requestId);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events") {
      await streamEvents(request, response, url, options, activeFeeds, requestId);
      return;
    }
    if (await handleBusinessRoute(request, response, url, options, requestId)) return;
    if (
      !url.pathname.startsWith("/api/") &&
      await serveWebApplication(request, response, url, options.webRoot, requestId)
    ) return;
    writeApiError(response, 404, "NOT_FOUND", "Route not found.", requestId);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    const mapped = mapApiError(error);
    writeApiError(response, mapped.status, mapped.code, mapped.message, requestId);
  }
}

function isAuthorized(request: IncomingMessage, url: URL, configuredToken: string | undefined): boolean {
  const expected = configuredToken?.trim();
  if (!expected) return true;
  const authorization = request.headers.authorization?.trim() ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim();
  const received = bearer || request.headers["x-lyra-access-token"]?.toString().trim()
    || url.searchParams.get("access_token")?.trim();
  if (!received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

async function serveWebApplication(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  configuredRoot: string | undefined,
  requestId: string
): Promise<boolean> {
  if (!configuredRoot || (request.method !== "GET" && request.method !== "HEAD")) return false;
  const root = resolve(configuredRoot);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  let filePath = resolve(root, requestedPath);
  if (!isPathInside(root, filePath) || !(await isFile(filePath))) {
    filePath = resolve(root, "index.html");
  }
  if (!isPathInside(root, filePath) || !(await isFile(filePath))) return false;

  const body = await readFile(filePath);
  const isIndex = filePath === resolve(root, "index.html");
  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": body.byteLength,
    "Cache-Control": isIndex ? "no-cache" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId
  });
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(filePath: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
  return types[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function streamEvents(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: CreateApiServerOptions,
  activeFeeds: Set<AbortController>,
  requestId: string
): Promise<void> {
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) throw new Error("projectId is required.");
  const afterEventId = parseEventId(
    url.searchParams.get("afterEventId") ?? headerValue(request.headers["last-event-id"]) ?? "0"
  );
  const controller = new AbortController();
  activeFeeds.add(controller);
  response.on("close", () => controller.abort());
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Request-ID": requestId
  });
  response.flushHeaders();
  response.write("retry: 1000\n\n");
  const heartbeat = setInterval(() => {
    if (!response.destroyed) response.write(encodeServerSentEventHeartbeat());
  }, options.heartbeatIntervalMs ?? 15_000);
  heartbeat.unref();
  try {
    for await (const event of options.events.subscribe({
      projectId,
      afterId: afterEventId,
      pollIntervalMs: options.eventPollIntervalMs ?? 250,
      signal: controller.signal,
      ...(url.searchParams.has("conversationId")
        ? { conversationId: requireQueryValue(url, "conversationId") }
        : {})
    })) {
      if (response.destroyed) break;
      if (!response.write(encodeServerSentEvent(event))) {
        await waitForDrain(response, controller.signal);
      }
    }
  } finally {
    clearInterval(heartbeat);
    activeFeeds.delete(controller);
    if (!response.destroyed) response.end();
  }
}

function writeApiError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string
): void {
  writeJson(response, status, { error: { code, message, details: null }, requestId }, requestId);
}
function mapApiError(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  if (error instanceof ServiceUnavailableError) return { status: 503, code: "NOT_READY", message };
  if (/not found/iu.test(message) || /NotFound/u.test(name)) {
    return { status: 404, code: "NOT_FOUND", message };
  }
  if (/Transition/u.test(name) || /cannot|not awaiting|not available|must be enabled|read-only/iu.test(message)) {
    return { status: 409, code: "CONFLICT", message };
  }
  return { status: 400, code: "VALIDATION_ERROR", message };
}
