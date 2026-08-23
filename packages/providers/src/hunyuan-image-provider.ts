import { createHash, createHmac } from "node:crypto";
import type { GenerationRequest } from "@lyra/contracts";
import type { BinaryImageProvider, GeneratedImageBinary } from "@lyra/core";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";

export interface HunyuanImageProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  secondaryApiKey: string | null;
  model: string;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class HunyuanImageProvider implements BinaryImageProvider {
  readonly #api: HunyuanImageApiClient;
  readonly #client: ProviderHttpClient;

  constructor(options: HunyuanImageProviderOptions) {
    this.#client = options.client ?? new ProviderHttpClient({ timeoutMs: 10 * 60_000 });
    this.#api = new HunyuanImageApiClient({
      baseUrl: options.baseUrl,
      secretId: options.apiKey,
      secretKey: options.secondaryApiKey,
      client: this.#client
    });
  }

  async generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedImageBinary[]> {
    if (request.attachments.length) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        "Tencent Hunyuan Image currently supports text-to-image only in Lyra."
      );
    }
    const submit = await this.#api.call("SubmitHunyuanImageJob", {
      Prompt: request.prompt,
      Num: request.count,
      Resolution: hunyuanResolution(request.parameters.aspectRatio ?? request.parameters.size),
      LogoAdd: 0,
      Revise: readBoolean(request.parameters.promptExtend, true)
    }, signal);
    const jobId = requireText(submit.JobId, "Hunyuan Image did not return a task ID.");
    for (;;) {
      signal?.throwIfAborted();
      const result = await this.#api.call("QueryHunyuanImageJob", { JobId: jobId }, signal);
      const status = String(result.JobStatusCode ?? "");
      if (status === "4") {
        throw new ProviderConnectionError(
          "INVALID_RESPONSE",
          readText(result.JobErrorMsg) ?? "Hunyuan Image generation failed."
        );
      }
      if (status === "5") {
        if (!Array.isArray(result.ResultImage) || !result.ResultImage.length) invalidResponse();
        const output: GeneratedImageBinary[] = [];
        for (const [index, value] of result.ResultImage.entries()) {
          if (typeof value !== "string" || !value) invalidResponse();
          const binary = await this.#client.getBinary(value, {}, signal);
          const mimeType = binary.mimeType ?? "image/jpeg";
          output.push({
            data: binary.data,
            mimeType,
            name: `hunyuan-output-${index + 1}.${mimeType === "image/png" ? "png" : "jpg"}`
          });
        }
        return output;
      }
      await delay(2_000, signal);
    }
  }
}

export interface HunyuanImageApiClientOptions {
  baseUrl: string;
  secretId: string | null;
  secretKey: string | null;
  client?: ProviderHttpClient;
}

export class HunyuanImageApiClient {
  readonly #baseUrl: string;
  readonly #secretId: string;
  readonly #secretKey: string;
  readonly #client: ProviderHttpClient;

  constructor(options: HunyuanImageApiClientOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Hunyuan Image Base URL").replace(/\/+$/u, "");
    this.#secretId = requireText(options.secretId, "Tencent Cloud SecretId");
    this.#secretKey = requireText(options.secretKey, "Tencent Cloud SecretKey");
    this.#client = options.client ?? new ProviderHttpClient();
  }

  async call(
    action: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const host = new URL(this.#baseUrl).host;
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const authorization = createAuthorization({
      action,
      body,
      date,
      host,
      secretId: this.#secretId,
      secretKey: this.#secretKey,
      timestamp
    });
    const value = await this.#client.requestJson(
      this.#baseUrl,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json; charset=utf-8",
          "X-TC-Action": action,
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Version": "2023-09-01",
          "X-TC-Region": "ap-guangzhou"
        },
        body
      },
      signal
    );
    if (!isRecord(value) || !isRecord(value.Response)) invalidResponse();
    if (isRecord(value.Response.Error)) {
      const code = readText(value.Response.Error.Code) ?? "";
      throw new ProviderConnectionError(
        tencentErrorCode(code),
        readText(value.Response.Error.Message) ?? "Tencent Cloud API request failed."
      );
    }
    return value.Response;
  }
}

function createAuthorization(input: {
  action: string;
  body: string;
  date: string;
  host: string;
  secretId: string;
  secretKey: string;
  timestamp: number;
}): string {
  const service = "hunyuan";
  const canonicalHeaders = [
    "content-type:application/json; charset=utf-8",
    `host:${input.host}`,
    `x-tc-action:${input.action.toLowerCase()}`
  ].join("\n") + "\n";
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256(input.body)
  ].join("\n");
  const credentialScope = `${input.date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(input.timestamp),
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const secretDate = hmac(`TC3${input.secretKey}`, input.date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hunyuanResolution(value: unknown): string {
  if (typeof value !== "string") return "1024:1024";
  switch (value.trim()) {
    case "1:1": return "1024:1024";
    case "16:9": return "1280:720";
    case "9:16": return "720:1280";
    case "4:3": return "1024:768";
    case "3:4": return "768:1024";
    default: return value.replace(/[x*]/u, ":");
  }
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", "Hunyuan promptExtend is invalid.");
  }
  return value;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", label);
  }
  return value.trim();
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tencentErrorCode(
  code: string
): "AUTHENTICATION_FAILED" | "PERMISSION_DENIED" | "RATE_LIMITED" | "SERVER_ERROR" | "BAD_REQUEST" {
  if (/^AuthFailure/iu.test(code)) return "AUTHENTICATION_FAILED";
  if (code === "UnauthorizedOperation") return "PERMISSION_DENIED";
  if (/(RequestLimitExceeded|LimitExceeded)/iu.test(code)) return "RATE_LIMITED";
  if (/^InternalError/iu.test(code)) return "SERVER_ERROR";
  return "BAD_REQUEST";
}

function invalidResponse(): never {
  throw new ProviderConnectionError("INVALID_RESPONSE", "Hunyuan Image response is invalid.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
