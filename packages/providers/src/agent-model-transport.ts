import { systemProxyFetch } from "./system-proxy.js";
import type { FetchLike } from "./provider-types.js";
import { ProviderConnectionError, sanitizeError } from "./provider-errors.js";

export interface AgentModelTransportOptions {
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/** One request lifetime includes headers AND the complete response body. No implicit retries. */
export class AgentModelTransport {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  constructor(options: AgentModelTransportOptions = {}) {
    this.fetch = options.fetchImplementation ?? systemProxyFetch;
    this.timeoutMs = positive(options.timeoutMs ?? 120_000);
    this.maxBytes = positive(options.maxResponseBytes ?? 16 * 1024 * 1024);

  }

  async *post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): AsyncGenerator<unknown> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new ProviderConnectionError("TIMEOUT", "模型响应超时。")), this.timeoutMs);
    timer.unref();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json", ...headers },
        body: JSON.stringify(body), signal: controller.signal, redirect: "error"
      });
      if (!response.ok) {
        const secrets = Object.entries(headers).filter(([key]) => /authorization|api-key/iu.test(key))
          .map(([, value]) => value.replace(/^Bearer\s+/iu, ""));
        const upstreamError = sanitizeError(new Error(await readErrorBody(response)), secrets).message;
        throw new ProviderConnectionError(response.status === 401 || response.status === 403 ? "AUTHENTICATION_FAILED" :
          response.status === 429 ? "RATE_LIMITED" : "INVALID_RESPONSE", upstreamError || `HTTP ${response.status} ${response.statusText}`, response.status);
      }
      if (!response.body) throw new ProviderConnectionError("INVALID_RESPONSE", "模型接口没有响应体。");
      reader = response.body.getReader();
      // Cancel a pending read as well as fetch when callers stop or the overall timeout expires.
      const cancelReader = () => { void reader?.cancel().catch(() => {}); };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let streaming = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;
        let buffer = "";
        let bytes = 0;
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) { buffer += decoder.decode(); break; }
          bytes += value.byteLength;
          if (bytes > this.maxBytes) throw new ProviderConnectionError("INVALID_RESPONSE", "模型响应超过大小限制。");
          buffer += decoder.decode(value, { stream: true });
          // Some upstream gateways label SSE as JSON/text or omit Content-Type.
          // Wait for a complete field prefix: it may straddle network chunks.
          if (!streaming && /^(?:event:|data:|id:|retry:|:)/u.test(buffer.trimStart())) {
            streaming = true;
            buffer = buffer.trimStart();
          }
          if (!streaming) continue;
          // A CRLF may straddle network chunks. Match delimiters without rewriting partial lines.
          let match: RegExpExecArray | null;
          while ((match = /\r?\n\r?\n/u.exec(buffer))) {
            const frame = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).replace(/^ /u, "")).join("\n");
            if (data === "[DONE]") return;
            if (data) yield JSON.parse(data) as unknown;
          }
        }
        if (!streaming) yield JSON.parse(buffer) as unknown;
        else if (buffer.trim()) throw new ProviderConnectionError("INVALID_RESPONSE", "模型事件流不完整。");
      } finally { controller.signal.removeEventListener("abort", cancelReader); }
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      controller.abort();
    }
  }
}

function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("模型传输限制必须为正整数。");
  return value;
}

async function readErrorBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < 64 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, 64 * 1024 - size);
      chunks.push(chunk); size += chunk.length;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
